/**
 * renderer.ts — the WebGL2 rendering core.
 *
 * Owns the GL context, the StarField, and the Camera. Drives a rAF loop that
 * updates the camera (inertia + auto-drift), clears, and draws the star field.
 * Wires pointer/wheel/dblclick interaction on the canvas and maintains an FPS
 * EMA for the perf HUD.
 *
 * Theme-agnostic: callers supply a per-star RGB Float32Array via setScene.
 *
 * Effects note (Task 6): the frame() method is the single place where draw
 * passes are issued. A later effects pass can render into the same frame after
 * the star draw; `gl`, `camera`, and the current viewport are kept accessible
 * to internal modules for that purpose. No effect stubs are added now.
 */

import type { SceneState, LayoutFrame } from "@/lib/types";
import { SUPERNOVA_MS } from "@/lib/timeline/scene";
import { Camera } from "./camera";
import { StarField } from "./stars";
import { Effects } from "./effects";
import { BloomPipeline, type BloomQuality } from "./post";
import { WATERMARK_VERT, WATERMARK_FRAG, compileProgram } from "./shaders";

export class WebGLUnsupportedError extends Error {
  constructor(message = "WebGL2 is not supported in this browser") {
    super(message);
    this.name = "WebGLUnsupportedError";
  }
}

export class Renderer {
  readonly camera: Camera;

  /** FPS exponential moving average (alpha 0.1). */
  fps = 0;

  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly starField: StarField;
  private readonly effects: Effects;
  private readonly post: BloomPipeline;
  private readonly resizeObserver: ResizeObserver | null;

  // Offscreen export renderers manage their own fixed backing-store size and
  // skip DOM-bound resize/interaction wiring (the canvas is not in the page).
  private readonly offscreen: boolean;

  // Staged scene data (latest wins; drawn every frame).
  private positions: Float32Array | null = null;
  private sizes: Float32Array | null = null;
  private colors: Float32Array | null = null;
  private pulses: Float32Array | null = null;
  private scene: SceneState | null = null;
  private starCount = 0;
  private dirty = false;

  // Bloom strength fed to the composite pass.
  private bloomStrength = 1.2;

  // Supernova shake bookkeeping: track the `t` of supernovas we've already
  // shaken for, so each newly activated supernova shakes the camera once.
  private readonly shakenSupernovas = new Set<number>();
  private lastSceneT = 0;

  // Auto-quality: if the FPS EMA stays below 40 for 3 cumulative seconds
  // without crossing back above 40, bloom is disabled once and never
  // auto-re-enabled (documented).
  private lowFpsSinceMs = 0;
  private autoLowApplied = false;

  private clear: [number, number, number] = [0.02, 0.02, 0.05];

  // ── Watermark (export-only) ───────────────────────────────────────────────
  // When `watermark` is on, a "reporeel" wordmark is drawn bottom-right after
  // the post composite. The program + alpha texture are created lazily on first
  // enable so the live theater (watermark off) pays nothing. Live path keeps it
  // off; the export path turns it on.
  private watermark = false;
  private watermarkProgram: WebGLProgram | null = null;
  private watermarkTex: WebGLTexture | null = null;
  private watermarkVao: WebGLVertexArrayObject | null = null;
  private watermarkAspect = 1; // texture width/height, for clip-space sizing
  private uWmOffset: WebGLUniformLocation | null = null;
  private uWmScale: WebGLUniformLocation | null = null;
  private uWmTex: WebGLUniformLocation | null = null;
  private uWmAlpha: WebGLUniformLocation | null = null;

  private rafId = 0;
  private running = false;
  private lastTime = 0;
  private startTime = 0;

  private fpsCallbacks: Array<(fps: number) => void> = [];
  private contextLostCallbacks: Array<() => void> = [];

  // Bound context-loss handlers (stored for removal in dispose()).
  private readonly onContextLostHandler: (e: Event) => void;
  private readonly onContextRestoredHandler: () => void;

  // Pointer drag state.
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  // Bound handlers (stored so they can be removed on dispose).
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private readonly onWheel: (e: WheelEvent) => void;
  private readonly onDblClick: () => void;

  /**
   * @param canvas    target canvas (a DOM canvas for the live theater, or an
   *                  offscreen export canvas sized to the target resolution).
   * @param offscreen when true, the renderer is an export renderer: it does NOT
   *                  attach a ResizeObserver or pointer/wheel handlers (the
   *                  canvas is not in the DOM and its backing-store size is
   *                  fixed by the caller), and the GL viewport/post pipeline are
   *                  sized once to the canvas's width/height. Used by the
   *                  deterministic export path (see renderAt).
   */
  constructor(canvas: HTMLCanvasElement, offscreen = false) {
    this.canvas = canvas;
    this.offscreen = offscreen;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      // Export reads pixels back via VideoFrame(canvas); preserve so the drawn
      // buffer is still valid when WebCodecs samples the canvas.
      preserveDrawingBuffer: offscreen,
    });
    if (!gl) throw new WebGLUnsupportedError();
    this.gl = gl;

    this.starField = new StarField(gl);
    this.effects = new Effects(gl);
    this.post = new BloomPipeline(gl);
    this.camera = new Camera(0, 0, 1);

    // ── Context-loss handling ────────────────────────────────────────────
    this.onContextLostHandler = (e: Event) => {
      e.preventDefault(); // required to allow context restoration
      this.stop();        // halt the rAF loop; GPU resources are gone
      for (const cb of this.contextLostCallbacks) cb();
    };
    this.onContextRestoredHandler = () => {
      // Full GL resource re-creation on restore is out of scope; a page
      // reload recovers cleanly — TODO if it ever matters in practice.
    };

    // Offscreen export renderers: size the GL viewport + post pipeline once to
    // the fixed canvas backing store and skip all DOM-bound wiring.
    if (offscreen) {
      this.resizeObserver = null;
      gl.viewport(0, 0, canvas.width, canvas.height);
      this.post.resize(canvas.width, canvas.height);
      // Unused handlers (kept non-null to satisfy the readonly fields); never
      // attached because the canvas is not in the DOM.
      this.onPointerDown = () => {};
      this.onPointerMove = () => {};
      this.onPointerUp = () => {};
      this.onWheel = () => {};
      this.onDblClick = () => {};
      return;
    }

    canvas.addEventListener("webglcontextlost", this.onContextLostHandler);
    canvas.addEventListener("webglcontextrestored", this.onContextRestoredHandler);

    // ── Resize handling ──────────────────────────────────────────────────
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();

    // ── Pointer / wheel / dblclick interaction ───────────────────────────
    this.onPointerDown = (e) => {
      this.dragging = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.camera.mode = "free";
      this.camera.vx = 0;
      this.camera.vy = 0;
      canvas.setPointerCapture?.(e.pointerId);
    };
    this.onPointerMove = (e) => {
      if (!this.dragging) return;
      const dpr = this.dpr();
      const dx = (e.clientX - this.lastPointerX) * dpr;
      const dy = (e.clientY - this.lastPointerY) * dpr;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.camera.panBy(dx, dy, canvas.width, canvas.height);
    };
    this.onPointerUp = (e) => {
      this.dragging = false;
      canvas.releasePointerCapture?.(e.pointerId);
    };
    this.onWheel = (e) => {
      e.preventDefault();
      this.camera.mode = "free";
      const dpr = this.dpr();
      const factor = Math.pow(1.0015, -e.deltaY);
      this.camera.zoomAt(
        e.offsetX * dpr,
        e.offsetY * dpr,
        factor,
        canvas.width,
        canvas.height
      );
    };
    this.onDblClick = () => {
      this.camera.mode = "auto";
    };

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("dblclick", this.onDblClick);
  }

  /** Cap device pixel ratio at 2 to bound fill cost on hi-dpi displays. */
  private dpr(): number {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  private resize(): void {
    const dpr = this.dpr();
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.post.resize(this.canvas.width, this.canvas.height);
  }

  /**
   * Stage the latest frame data. `colors` is a per-star rgb Float32Array of
   * length 3 * starCount supplied by the caller (renderer stays theme-agnostic).
   * Star count is taken from scene.sizes.length.
   */
  setScene(scene: SceneState, layout: LayoutFrame, colors: Float32Array): void {
    this.positions = layout.positions;
    this.sizes = scene.sizes;
    this.pulses = scene.pulses;
    this.colors = colors;
    this.scene = scene;
    this.starCount = scene.sizes.length;
    this.dirty = true;
  }

  /** Star-id-indexed death times (epoch ms; NaN = alive) for collapse rings. */
  setDeaths(deaths: Float64Array): void {
    this.effects.setDeaths(deaths);
  }

  /** Accent color for supernova rings and comet trails (0..1 rgb). */
  setAccent(r: number, g: number, b: number): void {
    this.effects.setAccent(r, g, b);
  }

  /**
   * Bloom quality passthrough for the UI. "low" disables bloom entirely. Note:
   * auto-quality may have already forced "low" on sustained low FPS and will
   * never auto-re-enable; an explicit call here still takes effect.
   */
  setQuality(q: BloomQuality): void {
    this.post.setQuality(q);
  }

  setClearColor(r: number, g: number, b: number): void {
    this.clear = [r, g, b];
  }

  /** Subscribe to per-frame FPS updates (for the HUD). */
  onFrame(cb: (fps: number) => void): void {
    this.fpsCallbacks.push(cb);
  }

  /**
   * Subscribe to WebGL context-loss events. The rAF loop is already stopped
   * when the callback fires. Use this to show a recovery message in the UI
   * (e.g. "GPU context lost — please reload").
   */
  onContextLost(cb: () => void): void {
    this.contextLostCallbacks.push(cb);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.startTime = this.lastTime;
    const loop = (now: number) => {
      if (!this.running) return;
      this.frame(now);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private frame(now: number): void {
    const dt = Math.min(now - this.lastTime, 100);
    this.lastTime = now;

    // FPS EMA (alpha 0.1).
    if (dt > 0) {
      const inst = 1000 / dt;
      this.fps = this.fps === 0 ? inst : this.fps * 0.9 + inst * 0.1;
      for (const cb of this.fpsCallbacks) cb(this.fps);
    }

    // Auto-quality: disable bloom once after 3s of sustained sub-40 FPS.
    if (!this.autoLowApplied) {
      if (this.fps > 0 && this.fps < 40) {
        this.lowFpsSinceMs += dt;
        if (this.lowFpsSinceMs >= 3000) {
          this.post.setQuality("low");
          this.autoLowApplied = true;
          console.info("reporeel: bloom disabled (low fps)");
        }
      } else {
        this.lowFpsSinceMs = 0;
      }
    }

    this.drawCore(dt, now - this.startTime, false);
  }

  /**
   * Render exactly ONE deterministic frame of the given scene/layout/colors,
   * synchronously, into this renderer's canvas. Used by the offscreen export
   * path: the caller stages each planned frame (scene + the SAME static layout
   * snapshot from the live galaxy) and reads the canvas back into a VideoFrame.
   *
   * Determinism contract (vs the live frame()):
   *   - The camera does NOT auto-drift (framing is fixed by the caller before
   *     the export loop). Camera inertia is not advanced.
   *   - Supernova shake is suppressed (no wall-clock / accumulation coupling);
   *     a deterministic counter advances effects only.
   *   - No FPS / auto-quality mutation. The post pipeline runs at the current
   *     quality (set by the caller).
   *   - effects.update uses the passed `dt` (a fixed per-frame step, e.g.
   *     1000/fps) so trails/animation advance reproducibly per frame index.
   */
  renderAt(
    scene: SceneState,
    layout: LayoutFrame,
    colors: Float32Array,
    opts: { dt: number; deterministic?: boolean }
  ): void {
    this.setScene(scene, layout, colors);
    const deterministic = opts.deterministic !== false;
    // Drive effects/animation by the supplied dt; pass elapsed=0 since auto-drift
    // is suppressed in deterministic mode (the elapsed arg is unused then).
    this.drawCore(opts.dt, 0, deterministic);
  }

  /**
   * The single draw core shared by the live rAF loop (frame) and the
   * deterministic export path (renderAt). `dt` is the time step fed to
   * effects.update and camera inertia. `elapsed` is wall-time since start, used
   * only for camera auto-drift in the live path. When `deterministic`, camera
   * auto-drift and supernova-shake are suppressed and effects advance via a
   * frame counter, so the same inputs always produce the same pixels.
   */
  private drawCore(dt: number, elapsed: number, deterministic: boolean): void {
    const scene = this.scene;

    if (!deterministic && scene) {
      // Newly activated supernovas shake the camera once (magnitude > 0.6).
      // If scene time jumped backward (scrub/seek), reset the seen-set so future
      // forward playback re-triggers shakes.
      if (scene.t < this.lastSceneT) this.shakenSupernovas.clear();
      this.lastSceneT = scene.t;
      for (const sn of scene.activeSupernovas) {
        if (sn.magnitude <= 0.6) continue;
        // Identify a supernova by its activation time: age is (scene.t - sn.t) /
        // SUPERNOVA_MS, so scene.t - age * SUPERNOVA_MS recovers sn.t, which is
        // constant for a given event across frames regardless of current scene.t.
        const key = sn.starIds.length ? sn.starIds[0] * 1e9 + Math.round(scene.t - sn.age * SUPERNOVA_MS) : Math.round(scene.t);
        if (!this.shakenSupernovas.has(key)) {
          this.shakenSupernovas.add(key);
          this.camera.shake(sn.magnitude);
        }
      }
      // Bound the set so it can't grow without limit over a long session.
      if (this.shakenSupernovas.size > 512) this.shakenSupernovas.clear();
    }

    // Camera motion. Deterministic export keeps a fixed framing: no inertia, no
    // auto-drift, no shake jitter advance (shake amplitude stays whatever it is,
    // which is 0 because we never shake in deterministic mode).
    if (!deterministic) {
      this.camera.update(dt);
      this.camera.autoDrift(elapsed);
    }

    // Upload staged data if it changed.
    if (
      this.dirty &&
      this.positions &&
      this.sizes &&
      this.colors &&
      this.pulses
    ) {
      this.starField.upload(
        this.positions,
        this.sizes,
        this.colors,
        this.pulses,
        this.starCount
      );
      this.dirty = false;
    }

    // Draw passes for this frame. The scene (stars + effects) renders into the
    // bloom pipeline's offscreen target; post.end() applies bloom and composites
    // to the screen (a no-op in low quality, where begin() bound the screen).
    // GL STATE CONTRACT: each pass sets ALL state it needs and restores
    // blend/depthMask/program to defaults before returning.
    const gl = this.gl;
    const view = this.camera.viewMatrix(this.canvas.width, this.canvas.height);

    this.post.begin();
    gl.clearColor(this.clear[0], this.clear[1], this.clear[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.starField.draw(view, this.dpr(), this.camera.zoom);

    if (this.positions) {
      this.effects.update(
        scene ?? { activeSupernovas: [], cometPositions: [] } as unknown as SceneState,
        this.positions,
        dt
      );
      this.effects.draw(view, scene ? scene.t : 0);
    }

    this.post.end(this.bloomStrength);

    // Watermark (export-only) drawn last, directly over the composited frame.
    if (this.watermark) this.drawWatermark();
  }

  /**
   * Enable/disable the export watermark. Live theater leaves this off; the
   * export path turns it on so exported videos carry the "reporeel" wordmark.
   * The GL program + texture are created lazily on first enable.
   */
  setWatermark(on: boolean): void {
    this.watermark = on;
    if (on && !this.watermarkProgram) this.initWatermark();
  }

  private initWatermark(): void {
    const gl = this.gl;
    // Render the wordmark into a 2D canvas once, upload as an RGBA texture.
    const cw = 256;
    const ch = 64;
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, cw, ch);
    ctx.font = "600 40px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("reporeel", cw - 8, ch / 2 + 2);
    this.watermarkAspect = cw / ch;

    const tex = gl.createTexture();
    if (!tex) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.watermarkTex = tex;

    this.watermarkProgram = compileProgram(gl, WATERMARK_VERT, WATERMARK_FRAG);
    const vao = gl.createVertexArray();
    this.watermarkVao = vao;
    this.uWmOffset = gl.getUniformLocation(this.watermarkProgram, "u_offset");
    this.uWmScale = gl.getUniformLocation(this.watermarkProgram, "u_scale");
    this.uWmTex = gl.getUniformLocation(this.watermarkProgram, "u_tex");
    this.uWmAlpha = gl.getUniformLocation(this.watermarkProgram, "u_alpha");
  }

  private drawWatermark(): void {
    const gl = this.gl;
    const prog = this.watermarkProgram;
    const tex = this.watermarkTex;
    if (!prog || !tex || !this.watermarkVao) return;

    // Size: target ~16% of canvas width, preserving the wordmark aspect.
    const cw = this.canvas.width;
    const chh = this.canvas.height;
    const wPx = cw * 0.16;
    const hPx = wPx / this.watermarkAspect;
    const sx = wPx / cw; // clip half-extent x
    const sy = hPx / chh; // clip half-extent y
    const margin = 0.03;
    const ox = 1 - sx - margin; // bottom-right
    const oy = -1 + sy + margin;

    gl.useProgram(prog);
    gl.bindVertexArray(this.watermarkVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.uWmTex, 0);
    gl.uniform2f(this.uWmOffset, ox, oy);
    gl.uniform2f(this.uWmScale, sx, sy);
    gl.uniform1f(this.uWmAlpha, 0.4);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Restore GL state contract defaults.
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(null);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    if (this.watermarkProgram) this.gl.deleteProgram(this.watermarkProgram);
    if (this.watermarkTex) this.gl.deleteTexture(this.watermarkTex);
    if (this.watermarkVao) this.gl.deleteVertexArray(this.watermarkVao);
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("pointercancel", this.onPointerUp);
    c.removeEventListener("wheel", this.onWheel);
    c.removeEventListener("dblclick", this.onDblClick);
    c.removeEventListener("webglcontextlost", this.onContextLostHandler);
    c.removeEventListener("webglcontextrestored", this.onContextRestoredHandler);
    this.starField.dispose();
    this.effects.dispose();
    this.post.dispose();
    this.fpsCallbacks = [];
    this.contextLostCallbacks = [];
  }
}
