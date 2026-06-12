/**
 * camera.ts — 2D pan/zoom camera for the galaxy renderer.
 *
 * Coordinate conventions (kept consistent across viewMatrix / panBy /
 * screenToWorld / zoomAt):
 *   - World space: arbitrary units (the layout sim's output).
 *   - `zoom` is world-units → screen-pixels scale: 1 world unit spans `zoom`
 *     device pixels on BOTH axes (world units stay square).
 *   - Screen space here uses device pixels with origin at the viewport center,
 *     +x right, +y UP (matches clip space y, so no per-axis flip is needed and
 *     pan/zoom math stays sign-consistent with the view matrix).
 *
 * viewMatrix maps world → clip ([-1, 1]):
 *   clip.x = (wx - x) * zoom * (2 / vw)
 *   clip.y = (wy - y) * zoom * (2 / vh)
 * which is exactly: translate by (-x, -y), scale by zoom, then pixels→clip.
 */

export type CameraMode = "auto" | "free";

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  mode: CameraMode = "auto";

  // Inertia velocity in world units per ms.
  vx = 0;
  vy = 0;

  // Auto-drift base anchors (captured the first time autoDrift runs / on reset).
  private baseX = 0;
  private baseY = 0;
  private baseZoom = 1;
  private baseCaptured = false;

  // Reused per-frame matrix buffer (avoids allocating a Float32Array each draw).
  private readonly _view = new Float32Array(9);

  constructor(x = 0, y = 0, zoom = 1) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
    this.baseX = x;
    this.baseY = y;
    this.baseZoom = zoom;
  }

  /** Pan the world center by a screen-pixel delta (CSS px or device px — the
   *  caller picks; deltas are converted to world units via `zoom`).
   *  Dragging right (+dxScreen) should move content right, i.e. center left. */
  panBy(dxScreen: number, dyScreen: number, _viewportW: number, _viewportH: number): void {
    // 1 world unit == `zoom` screen pixels, so screen px / zoom == world units.
    const dxWorld = dxScreen / this.zoom;
    const dyWorld = dyScreen / this.zoom;
    // Screen y grows downward; world/clip y grows upward → invert dy.
    this.x -= dxWorld;
    this.y += dyWorld;
    // Record velocity for inertia (world units / ms set by the gesture cadence;
    // the caller may overwrite vx/vy directly for smoother flick handling).
    this.vx = -dxWorld;
    this.vy = dyWorld;
  }

  /** Zoom toward a screen point so the world point under it stays fixed.
   *  screenX/screenY are in viewport pixels with origin at TOP-LEFT. */
  zoomAt(
    screenX: number,
    screenY: number,
    factor: number,
    viewportW: number,
    viewportH: number
  ): void {
    const before = this.screenToWorld(screenX, screenY, viewportW, viewportH);
    this.zoom = clampZoom(this.zoom * factor);
    const after = this.screenToWorld(screenX, screenY, viewportW, viewportH);
    // Shift center so the world point under the cursor is unchanged.
    this.x += before[0] - after[0];
    this.y += before[1] - after[1];
    this.baseCaptured = false; // re-anchor auto-drift around the new framing
  }

  /** Convert a top-left-origin viewport pixel to world coordinates. */
  screenToWorld(
    sx: number,
    sy: number,
    viewportW: number,
    viewportH: number
  ): [number, number] {
    // Pixel offset from viewport center, with y flipped to point up.
    const px = sx - viewportW / 2;
    const py = viewportH / 2 - sy;
    return [this.x + px / this.zoom, this.y + py / this.zoom];
  }

  /** Apply inertia with frame-rate-independent decay. */
  update(dtMs: number): void {
    if (this.vx === 0 && this.vy === 0) return;
    this.x += this.vx * dtMs;
    this.y += this.vy * dtMs;
    const decay = Math.pow(0.92, dtMs / 16.67);
    this.vx *= decay;
    this.vy *= decay;
    if (Math.abs(this.vx) < 1e-4 && Math.abs(this.vy) < 1e-4) {
      this.vx = 0;
      this.vy = 0;
    }
  }

  /** When in "auto" mode, drift the center on a Lissajous path and breathe zoom. */
  autoDrift(tMs: number): void {
    if (this.mode !== "auto") return;
    if (!this.baseCaptured) {
      this.baseX = this.x;
      this.baseY = this.y;
      this.baseZoom = this.zoom;
      this.baseCaptured = true;
    }
    const ampX = 120 / this.baseZoom;
    const ampY = 90 / this.baseZoom;
    this.x = this.baseX + ampX * Math.sin(tMs * 0.00007);
    this.y = this.baseY + ampY * Math.sin(tMs * 0.00009 + 1.3);
    this.zoom = this.baseZoom * (1 + 0.06 * Math.sin(tMs * 0.00011));
  }

  /** 3x3 column-major view matrix mapping world → clip space. */
  viewMatrix(viewportW: number, viewportH: number): Float32Array {
    const sx = (this.zoom * 2) / viewportW;
    const sy = (this.zoom * 2) / viewportH;
    // Column-major mat3:
    //   | sx   0   -x*sx |
    //   | 0    sy  -y*sy |
    //   | 0    0    1     |
    const m = this._view;
    m[0] = sx; m[1] = 0; m[2] = 0;
    m[3] = 0; m[4] = sy; m[5] = 0;
    m[6] = -this.x * sx; m[7] = -this.y * sy; m[8] = 1;
    return m;
  }
}

/** Clamp zoom to a sane range to avoid degenerate / overflow framings. */
function clampZoom(z: number): number {
  const MIN = 0.01;
  const MAX = 100;
  return z < MIN ? MIN : z > MAX ? MAX : z;
}
