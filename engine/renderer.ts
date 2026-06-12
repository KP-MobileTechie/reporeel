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
import { Camera } from "./camera";
import { StarField } from "./stars";

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
  private readonly resizeObserver: ResizeObserver;

  // Staged scene data (latest wins; drawn every frame).
  private positions: Float32Array | null = null;
  private sizes: Float32Array | null = null;
  private colors: Float32Array | null = null;
  private pulses: Float32Array | null = null;
  private starCount = 0;
  private dirty = false;

  private clear: [number, number, number] = [0.02, 0.02, 0.05];

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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new WebGLUnsupportedError();
    this.gl = gl;

    this.starField = new StarField(gl);
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
    this.starCount = scene.sizes.length;
    this.dirty = true;
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

    // Camera motion.
    this.camera.update(dt);
    this.camera.autoDrift(now - this.startTime);

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

    // Draw passes for this frame.
    const gl = this.gl;
    gl.clearColor(this.clear[0], this.clear[1], this.clear[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const view = this.camera.viewMatrix(this.canvas.width, this.canvas.height);
    this.starField.draw(view, this.dpr(), this.camera.zoom);
    // (Task 6 effects passes — supernova/comet/bloom — render here, into the
    // same frame. GL STATE CONTRACT: each pass sets ALL state it needs and
    // restores blend/depthMask/program to defaults (disabled/true/null)
    // before returning, so passes are composable and order-independent.)
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
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
    this.fpsCallbacks = [];
    this.contextLostCallbacks = [];
  }
}
