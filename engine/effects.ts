/**
 * effects.ts — supernova rings, comet trails, and star-death collapse rings.
 *
 * One class (Effects) owns three sub-passes, all sharing the engine GL STATE
 * CONTRACT (see stars.ts): every draw path sets ALL state it needs (program,
 * blend, depthMask, VAO) and RESTORES blend/depthMask/program/VAO to defaults
 * (BLEND disabled, depthMask true, program null, VAO null) before returning, so
 * the passes stay composable and order-independent with the star pass and the
 * bloom pipeline.
 *
 * Geometry & buffers:
 *   - A single static unit-circle line-strip buffer (RING_SEGMENTS+1 verts) is
 *     shared by the supernova rings AND the collapse rings, each drawn with a
 *     per-ring (u_center, u_radius, u_color, u_alpha) transform.
 *   - One dynamic buffer holds ALL comet ribbons + heads for the frame, built
 *     CPU-side into a reused Float32Array and uploaded once (one draw call).
 *
 * CPU per-frame work (documented, no surprise GC):
 *   - Per-author ring buffers of recent head positions (capacity TRAIL_LEN).
 *     Updated in update(); rebuilt into the shared interleaved CPU array in
 *     draw(). The interleaved array is reused across frames and only grown when
 *     a frame needs more vertices than before.
 *   - Collapse scan is O(stars) over the deaths array each draw() — acceptable
 *     per the task; capped to MAX_COLLAPSES drawn rings.
 */

import {
  RING_VERT,
  RING_FRAG,
  TRAIL_VERT,
  TRAIL_FRAG,
  compileProgram,
} from "./shaders";

const RING_SEGMENTS = 64;

const TRAIL_LEN = 24; // ring-buffer capacity per author
const MAX_COMETS = 32; // simultaneously rendered comets (most-recent wins)
const TRAIL_HEAD_WIDTH = 3.0; // world units at the head, taper to 0 at the tail
const TRAIL_HEAD_ALPHA = 0.8; // alpha at the head, taper to 0 at the tail
const TRAIL_DECAY_MS = 1000; // drop an author's trail after this long without updates

const COLLAPSE_MS = 1200;
const COLLAPSE_RADIUS = 14; // world units at p=0
const MAX_COLLAPSES = 64; // collapse rings drawn per frame

const SUPERNOVA_RADIUS = 220; // world units * age * magnitude

/** Per-author comet trail state: a small ring buffer of recent head positions. */
interface Trail {
  xs: Float32Array; // length TRAIL_LEN
  ys: Float32Array;
  count: number; // number of valid points (<= TRAIL_LEN)
  head: number; // index of the most-recent point
  lastSeenMs: number; // wall-clock-ish accumulated time of last update
}

export class Effects {
  private readonly gl: WebGL2RenderingContext;

  // Ring program + shared unit-circle geometry.
  private readonly ringProgram: WebGLProgram;
  private readonly ringVao: WebGLVertexArrayObject;
  private readonly ringBuf: WebGLBuffer;
  private readonly uRingView: WebGLUniformLocation | null;
  private readonly uRingCenter: WebGLUniformLocation | null;
  private readonly uRingRadius: WebGLUniformLocation | null;
  private readonly uRingColor: WebGLUniformLocation | null;
  private readonly uRingAlpha: WebGLUniformLocation | null;

  // Trail program + one dynamic buffer rebuilt per frame.
  private readonly trailProgram: WebGLProgram;
  private readonly trailVao: WebGLVertexArrayObject;
  private readonly trailBuf: WebGLBuffer;
  private readonly uTrailView: WebGLUniformLocation | null;
  private readonly uTrailColor: WebGLUniformLocation | null;

  // Reused CPU vertex scratch for comet ribbons/heads. Interleaved [x,y,alpha].
  private trailVerts = new Float32Array(0);
  private trailVertCount = 0; // number of vertices staged this frame
  private trailCapacity = 0; // GPU buffer capacity in vertices

  // Accent color (default brand violet). Used by supernova rings and comets.
  private accent: [number, number, number] = [0.55, 0.36, 0.96];

  // Star-id-indexed death times (NaN = alive). Owned by caller; held by ref.
  private deaths: Float64Array | null = null;

  // Per-author trail map. Authors absent for TRAIL_DECAY_MS are pruned.
  private readonly trails = new Map<string, Trail>();

  // Latest scene (kept between update() and draw()).
  private positions: Float32Array | null = null;
  private supernovas: { starIds: number[]; age: number; magnitude: number }[] = [];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;

    // ── Ring program + static unit-circle line strip ───────────────────────
    this.ringProgram = compileProgram(gl, RING_VERT, RING_FRAG);
    const circle = new Float32Array((RING_SEGMENTS + 1) * 2);
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      circle[i * 2] = Math.cos(a);
      circle[i * 2 + 1] = Math.sin(a);
    }
    this.ringVao = createVao(gl);
    this.ringBuf = createBuffer(gl);
    gl.bindVertexArray(this.ringVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ringBuf);
    gl.bufferData(gl.ARRAY_BUFFER, circle, gl.STATIC_DRAW);
    {
      const aUnit = gl.getAttribLocation(this.ringProgram, "a_unit");
      if (aUnit >= 0) {
        gl.enableVertexAttribArray(aUnit);
        gl.vertexAttribPointer(aUnit, 2, gl.FLOAT, false, 0, 0);
      }
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.uRingView = gl.getUniformLocation(this.ringProgram, "u_view");
    this.uRingCenter = gl.getUniformLocation(this.ringProgram, "u_center");
    this.uRingRadius = gl.getUniformLocation(this.ringProgram, "u_radius");
    this.uRingColor = gl.getUniformLocation(this.ringProgram, "u_color");
    this.uRingAlpha = gl.getUniformLocation(this.ringProgram, "u_alpha");

    // ── Trail program + dynamic interleaved (x,y,alpha) buffer ──────────────
    this.trailProgram = compileProgram(gl, TRAIL_VERT, TRAIL_FRAG);
    this.trailVao = createVao(gl);
    this.trailBuf = createBuffer(gl);
    gl.bindVertexArray(this.trailVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuf);
    {
      const aPos = gl.getAttribLocation(this.trailProgram, "a_pos");
      const aAlpha = gl.getAttribLocation(this.trailProgram, "a_alpha");
      const stride = 3 * 4; // x,y,alpha floats
      if (aPos >= 0) {
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
      }
      if (aAlpha >= 0) {
        gl.enableVertexAttribArray(aAlpha);
        gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, stride, 2 * 4);
      }
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.uTrailView = gl.getUniformLocation(this.trailProgram, "u_view");
    this.uTrailColor = gl.getUniformLocation(this.trailProgram, "u_color");
  }

  setAccent(r: number, g: number, b: number): void {
    this.accent = [r, g, b];
  }

  /** Star-id-indexed death times (epoch ms); NaN for alive stars. */
  setDeaths(deaths: Float64Array): void {
    this.deaths = deaths;
  }

  /**
   * Advance comet trail ring buffers and cache the frame's scene data. Pushes
   * the current head position for each cometPosition; prunes authors not seen
   * for TRAIL_DECAY_MS. Caps tracked comets to MAX_COMETS (most-recent wins).
   */
  update(
    scene: {
      activeSupernovas: { starIds: number[]; age: number; magnitude: number }[];
      cometPositions: { author: string; fromStar: number; toStar: number; progress: number }[];
    },
    positions: Float32Array,
    dtMs: number
  ): void {
    this.positions = positions;
    this.supernovas = scene.activeSupernovas;

    // Age every known trail (used for decay-based pruning).
    for (const t of this.trails.values()) t.lastSeenMs += dtMs;

    // Cap to the most-recent MAX_COMETS comet positions this frame.
    const comets = scene.cometPositions;
    const start = comets.length > MAX_COMETS ? comets.length - MAX_COMETS : 0;

    for (let i = start; i < comets.length; i++) {
      const c = comets[i];
      const fx = positions[c.fromStar * 2];
      const fy = positions[c.fromStar * 2 + 1];
      const tx = positions[c.toStar * 2];
      const ty = positions[c.toStar * 2 + 1];
      // Skip if either endpoint position is missing/NaN (e.g. dead star).
      if (!isFinite(fx) || !isFinite(fy) || !isFinite(tx) || !isFinite(ty)) continue;
      const hx = fx + (tx - fx) * c.progress;
      const hy = fy + (ty - fy) * c.progress;

      let trail = this.trails.get(c.author);
      if (!trail) {
        trail = {
          xs: new Float32Array(TRAIL_LEN),
          ys: new Float32Array(TRAIL_LEN),
          count: 0,
          head: -1,
          lastSeenMs: 0,
        };
        this.trails.set(c.author, trail);
      }
      trail.head = (trail.head + 1) % TRAIL_LEN;
      trail.xs[trail.head] = hx;
      trail.ys[trail.head] = hy;
      if (trail.count < TRAIL_LEN) trail.count++;
      trail.lastSeenMs = 0;
    }

    // Prune trails not updated within TRAIL_DECAY_MS (clears the ring buffer).
    for (const [author, t] of this.trails) {
      if (t.lastSeenMs > TRAIL_DECAY_MS) this.trails.delete(author);
    }
  }

  /** Draw rings, comet trails, and collapse rings for the current frame. */
  draw(view: Float32Array, t: number): void {
    this.drawSupernovas(view);
    this.drawTrails(view);
    this.drawCollapses(view, t);
  }

  // ── Supernova rings ──────────────────────────────────────────────────────
  private drawSupernovas(view: Float32Array): void {
    const pos = this.positions;
    if (!pos || this.supernovas.length === 0) return;
    const gl = this.gl;

    gl.useProgram(this.ringProgram);
    gl.bindVertexArray(this.ringVao);
    gl.uniformMatrix3fv(this.uRingView, false, view);
    gl.uniform3f(this.uRingColor, this.accent[0], this.accent[1], this.accent[2]);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // additive
    gl.depthMask(false);

    for (const sn of this.supernovas) {
      const ids = sn.starIds;
      if (ids.length === 0) continue;
      // Centroid of the supernova's star positions (skip NaN positions).
      let cx = 0;
      let cy = 0;
      let n = 0;
      for (let i = 0; i < ids.length; i++) {
        const x = pos[ids[i] * 2];
        const y = pos[ids[i] * 2 + 1];
        if (isFinite(x) && isFinite(y)) {
          cx += x;
          cy += y;
          n++;
        }
      }
      if (n === 0) continue;
      cx /= n;
      cy /= n;
      const radius = sn.age * SUPERNOVA_RADIUS * sn.magnitude;
      const alpha = 1 - sn.age;
      if (alpha <= 0 || radius <= 0) continue;
      gl.uniform2f(this.uRingCenter, cx, cy);
      gl.uniform1f(this.uRingRadius, radius);
      gl.uniform1f(this.uRingAlpha, alpha);
      gl.drawArrays(gl.LINE_STRIP, 0, RING_SEGMENTS + 1);
    }

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.useProgram(null);
    gl.bindVertexArray(null);
  }

  // ── Comet trails ───────────────────────────────────────────────────────
  private drawTrails(view: Float32Array): void {
    if (this.trails.size === 0) return;
    this.buildTrailVertices();
    if (this.trailVertCount === 0) return;
    const gl = this.gl;

    // Upload (grow buffer if needed; otherwise sub-update).
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuf);
    if (this.trailVertCount > this.trailCapacity) {
      gl.bufferData(gl.ARRAY_BUFFER, this.trailVerts, gl.DYNAMIC_DRAW);
      this.trailCapacity = this.trailVerts.length / 3;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.trailVerts, 0, this.trailVertCount * 3);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    gl.useProgram(this.trailProgram);
    gl.bindVertexArray(this.trailVao);
    gl.uniformMatrix3fv(this.uTrailView, false, view);
    gl.uniform3f(this.uTrailColor, this.accent[0], this.accent[1], this.accent[2]);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // additive
    gl.depthMask(false);

    // One draw call: a single triangle-strip array containing every comet's
    // ribbon AND head quad, separated by degenerate (zero-alpha) vertices so
    // the strip "lifts" between comets without drawing visible connectors.
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.trailVertCount);

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.useProgram(null);
    gl.bindVertexArray(null);
  }

  /**
   * Rebuild this.trailVerts (interleaved x,y,alpha) for all live trails.
   *
   * Each trail becomes a triangle-strip ribbon: for each consecutive pair of
   * trail points we emit two vertices offset perpendicular to the segment by a
   * half-width that tapers from TRAIL_HEAD_WIDTH (head) to 0 (tail); alpha
   * tapers TRAIL_HEAD_ALPHA -> 0 likewise. The head is drawn as a small bright
   * quad appended to the same strip (simpler than a second gl.POINTS draw, and
   * keeps everything in one buffer / one draw — documented choice).
   *
   * Degenerate vertices (alpha 0, duplicated position) separate sub-strips so
   * the single TRIANGLE_STRIP draw produces no spurious connecting triangles.
   */
  private buildTrailVertices(): void {
    // Order points head -> tail for each trail and count required vertices.
    // Worst case per trail: ribbon (2 per point) + head quad (4) + up to 4
    // degenerate stitch verts. Allocate generously, then trim via count.
    const maxPerTrail = TRAIL_LEN * 2 + 8;
    const needed = this.trails.size * maxPerTrail * 3;
    if (this.trailVerts.length < needed) {
      this.trailVerts = new Float32Array(needed);
    }
    const v = this.trailVerts;
    let o = 0; // float offset
    let first = true;

    const push = (x: number, y: number, a: number): void => {
      v[o++] = x;
      v[o++] = y;
      v[o++] = a;
    };

    for (const trail of this.trails.values()) {
      if (trail.count < 2) continue;

      // Materialize ordered points head(newest) -> tail(oldest).
      const pts: number[] = [];
      for (let i = 0; i < trail.count; i++) {
        const idx = (trail.head - i + TRAIL_LEN) % TRAIL_LEN;
        pts.push(trail.xs[idx], trail.ys[idx]);
      }
      const segCount = trail.count - 1;

      // Stitch: emit a degenerate vertex (repeat first ribbon vertex) so this
      // sub-strip is not connected to the previous one. Skipped for the first.
      const headX = pts[0];
      const headY = pts[1];

      // Build per-point ribbon vertices.
      // Perpendicular per point uses the direction to the next point.
      const ribbon: number[] = []; // x,y,alpha triples (2 per point)
      for (let i = 0; i < trail.count; i++) {
        const px = pts[i * 2];
        const py = pts[i * 2 + 1];
        // direction toward the next (older) point for the offset basis
        let dx: number;
        let dy: number;
        if (i < segCount) {
          dx = pts[(i + 1) * 2] - px;
          dy = pts[(i + 1) * 2 + 1] - py;
        } else {
          dx = px - pts[(i - 1) * 2];
          dy = py - pts[(i - 1) * 2 + 1];
        }
        const len = Math.hypot(dx, dy) || 1;
        // perpendicular (normalized)
        const nx = -dy / len;
        const ny = dx / len;
        const taper = 1 - i / segCount; // 1 at head, 0 at tail
        const halfW = (TRAIL_HEAD_WIDTH * taper) / 2;
        const alpha = TRAIL_HEAD_ALPHA * taper;
        ribbon.push(px + nx * halfW, py + ny * halfW, alpha);
        ribbon.push(px - nx * halfW, py - ny * halfW, alpha);
      }

      // Emit ribbon, with a leading stitch if this isn't the first sub-strip.
      if (!first) {
        // Repeat first ribbon vertex with alpha 0 twice to lift the strip.
        push(ribbon[0], ribbon[1], 0);
        push(ribbon[0], ribbon[1], 0);
      }
      for (let k = 0; k < ribbon.length; k += 3) {
        push(ribbon[k], ribbon[k + 1], ribbon[k + 2]);
      }

      // Head quad: a small bright square centered on the head, appended via a
      // degenerate stitch from the last ribbon vertex.
      const hw = TRAIL_HEAD_WIDTH; // head quad half-extent (world units)
      const lastIdx = ribbon.length - 3;
      push(ribbon[lastIdx], ribbon[lastIdx + 1], 0); // stitch from ribbon end
      push(headX - hw, headY - hw, 0); // stitch into quad
      push(headX - hw, headY - hw, TRAIL_HEAD_ALPHA);
      push(headX + hw, headY - hw, TRAIL_HEAD_ALPHA);
      push(headX - hw, headY + hw, TRAIL_HEAD_ALPHA);
      push(headX + hw, headY + hw, TRAIL_HEAD_ALPHA);

      first = false;
    }

    this.trailVertCount = o / 3;
  }

  // ── Star-death collapse rings ─────────────────────────────────────────────
  private drawCollapses(view: Float32Array, t: number): void {
    const deaths = this.deaths;
    const pos = this.positions;
    if (!deaths || !pos) return;
    const gl = this.gl;

    // Collect dying ids by scanning the deaths array (O(stars); documented).
    // We draw at most MAX_COLLAPSES rings per frame.
    let bound = false;
    let drawn = 0;
    const n = Math.min(deaths.length, pos.length / 2);
    for (let id = 0; id < n && drawn < MAX_COLLAPSES; id++) {
      const death = deaths[id];
      if (!isFinite(death)) continue; // NaN = alive
      const dt = t - death;
      if (dt < 0 || dt > COLLAPSE_MS) continue;
      const x = pos[id * 2];
      const y = pos[id * 2 + 1];
      if (!isFinite(x) || !isFinite(y)) continue;

      const p = dt / COLLAPSE_MS;
      const radius = (1 - p) * COLLAPSE_RADIUS;
      const alpha = 0.8 * (1 - p);
      if (radius <= 0 || alpha <= 0) continue;

      if (!bound) {
        // Set up the dark-ring pass once (only if something will draw).
        gl.useProgram(this.ringProgram);
        gl.bindVertexArray(this.ringVao);
        gl.uniformMatrix3fv(this.uRingView, false, view);
        gl.uniform3f(this.uRingColor, 0, 0, 0); // black
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // subtractive look on dark bg
        gl.depthMask(false);
        bound = true;
      }

      gl.uniform2f(this.uRingCenter, x, y);
      gl.uniform1f(this.uRingRadius, radius);
      gl.uniform1f(this.uRingAlpha, alpha);
      gl.drawArrays(gl.LINE_STRIP, 0, RING_SEGMENTS + 1);
      drawn++;
    }

    if (bound) {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.useProgram(null);
      gl.bindVertexArray(null);
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.ringBuf);
    gl.deleteVertexArray(this.ringVao);
    gl.deleteProgram(this.ringProgram);
    gl.deleteBuffer(this.trailBuf);
    gl.deleteVertexArray(this.trailVao);
    gl.deleteProgram(this.trailProgram);
    this.trails.clear();
  }
}

function createBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const b = gl.createBuffer();
  if (!b) throw new Error("Failed to create GL buffer");
  return b;
}

function createVao(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const v = gl.createVertexArray();
  if (!v) throw new Error("Failed to create VAO");
  return v;
}
