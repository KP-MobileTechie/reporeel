/// <reference lib="webworker" />
/**
 * worker.ts — message-passing plumbing for the layout sim.
 *
 * ALL physics logic lives in sim.ts; this file only wires messages.
 *
 * Double-buffer strategy:
 *   - `master` holds the sim's live positions and is NEVER transferred.
 *   - `spare`  is a copy that is transferred to the main thread (zero-copy).
 *   - After a transfer, `spare`'s buffer is detached; on the next frame we
 *     allocate a fresh Float32Array for spare if needed (the transferred one
 *     is now owned by the main thread).
 *
 * Message protocol:
 *   IN  {type:"init", starDirs:number[], dirCount:number, seed:number}
 *   IN  {type:"tick", dt:number}
 *   OUT {type:"frame", positions:Float32Array, version:number}  (buffer transferred)
 */

import { computeAnchors, initPositions, step } from "./sim";

// ── State ─────────────────────────────────────────────────────────────────────
let master: Float32Array = new Float32Array(0);
let spare: Float32Array = new Float32Array(0);
let velocities: Float32Array = new Float32Array(0);
let anchors: Float32Array = new Float32Array(0);
let starDirs: number[] = [];
let version = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────
function postFrame(): void {
  const n = master.length;
  // If spare was transferred its byteLength is 0 — reallocate.
  if (spare.byteLength < n * 4) {
    spare = new Float32Array(n);
  }
  spare.set(master);
  // Transfer spare; after this spare.buffer is detached.
  (self as unknown as Worker).postMessage(
    { type: "frame", positions: spare, version: version++ },
    [spare.buffer]
  );
  // spare is now detached; next postFrame will reallocate if byteLength === 0.
}

// ── Message handler ───────────────────────────────────────────────────────────
(self as unknown as Worker).onmessage = function (
  e: MessageEvent<
    | { type: "init"; starDirs: number[]; dirCount: number; seed: number }
    | { type: "tick"; dt: number }
  >
) {
  const msg = e.data;

  if (msg.type === "init") {
    starDirs = msg.starDirs;
    anchors = computeAnchors(msg.dirCount, msg.seed);
    master = initPositions(msg.starDirs, msg.dirCount, msg.seed);
    velocities = new Float32Array(master.length);
    spare = new Float32Array(master.length);
    version = 0;
    postFrame();
    return;
  }

  if (msg.type === "tick") {
    step(master, velocities, starDirs, anchors, msg.dt);
    postFrame();
    return;
  }
};
