import type { Timeline, SceneState } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Duration over which a commit-touch pulse decays from 1 to 0 (ms). */
export const PULSE_MS = 1500;

/** Duration of a supernova flash animation (ms). */
export const SUPERNOVA_MS = 2000;

// ---------------------------------------------------------------------------
// PreparedTimeline
//
// Precomputed structure for fast per-frame sampling.
//
// IMPORTANT – buffer reuse contract:
//   `sizes` and `pulses` inside PreparedTimeline are the SAME Float32Array
//   objects returned by every call to sceneAtTime().  Callers must copy them
//   (e.g. new Float32Array(scene.sizes)) before issuing the next sceneAtTime()
//   call if they need to retain the values.
// ---------------------------------------------------------------------------

export interface PreparedTimeline {
  /** Original timeline (kept for supernovas, comets, t0/t1). */
  readonly timeline: Timeline;
  /**
   * Per-star sorted touch-time arrays (extracted from sizeByTime[*][0]).
   * Indexed by star.id.  Used for binary-search pulse lookup.
   */
  readonly touchTimes: readonly number[][];
  /** Reusable sizes buffer (length = stars.length). */
  readonly sizes: Float32Array;
  /** Reusable pulses buffer (length = stars.length). */
  readonly pulses: Float32Array;
}

// ---------------------------------------------------------------------------
// Binary-search helpers
// ---------------------------------------------------------------------------

/**
 * Returns the index of the last element in the sorted array `arr` whose value
 * is <= `target`, or -1 if no such element exists.
 */
function upperBoundIndex(arr: readonly number[], target: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= target) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// prepare
// ---------------------------------------------------------------------------

/**
 * Precomputes everything the render loop needs for fast per-frame sampling.
 * Call once per timeline; the resulting PreparedTimeline is passed to
 * sceneAtTime() for every frame.
 */
export function prepare(timeline: Timeline): PreparedTimeline {
  const { stars } = timeline;
  const n = stars.length;

  // Pre-extract touch times (the t values of sizeByTime entries) per star.
  const touchTimes: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const sbt = stars[i].sizeByTime;
    const tt = new Array<number>(sbt.length);
    for (let j = 0; j < sbt.length; j++) {
      tt[j] = sbt[j][0];
    }
    touchTimes[i] = tt;
  }

  return {
    timeline,
    touchTimes,
    sizes: new Float32Array(n),
    pulses: new Float32Array(n),
  };
}

// ---------------------------------------------------------------------------
// sceneAtTime
// ---------------------------------------------------------------------------

/**
 * Returns the SceneState at timeline time `t`.
 *
 * `t` is clamped into [timeline.t0, timeline.t1] before sampling.
 *
 * NOTE: the `sizes` and `pulses` Float32Arrays in the returned SceneState
 * are the reusable buffers owned by `prepared` — they are the same object
 * references on every call.  Copy them before the next call if retention
 * is needed.
 */
export function sceneAtTime(prepared: PreparedTimeline, t: number): SceneState {
  const { timeline, touchTimes, sizes, pulses } = prepared;
  const { stars, supernovas, comets, t0, t1 } = timeline;

  // Clamp t into [t0, t1].
  const ct = t < t0 ? t0 : t > t1 ? t1 : t;

  const aliveStarIds: number[] = [];

  // O(stars) pass: fill sizes and pulses for each star.
  for (let i = 0; i < stars.length; i++) {
    const star = stars[i];
    const id = star.id; // id === i (guaranteed by buildTimeline)

    const alive = star.birth <= ct && (star.death === null || star.death > ct);

    if (!alive) {
      sizes[id] = 0;
      pulses[id] = 0;
      continue;
    }

    aliveStarIds.push(id);

    // --- size ---
    const sbt = star.sizeByTime;
    const tt = touchTimes[id];
    const lastSizeIdx = upperBoundIndex(tt, ct);
    const v = lastSizeIdx >= 0 ? sbt[lastSizeIdx][1] : 0;
    sizes[id] = 1 + Math.sqrt(v) / 10;

    // --- pulse ---
    // lastTouch = most recent touch time <= ct
    const lastTouchIdx = lastSizeIdx; // same binary search result (touch times === sizeByTime t values)
    if (lastTouchIdx < 0) {
      pulses[id] = 0;
    } else {
      const lastTouch = tt[lastTouchIdx];
      const elapsed = ct - lastTouch;
      pulses[id] = elapsed >= PULSE_MS ? 0 : 1 - elapsed / PULSE_MS;
    }
  }

  // --- active supernovas (binary-search windowed scan) ---
  // supernovas are sorted ascending by t (guaranteed by buildTimeline).
  // Active window: sn.t <= ct < sn.t + SUPERNOVA_MS
  //   ↔  ct - SUPERNOVA_MS < sn.t <= ct
  // Find the first index where sn.t > ct - SUPERNOVA_MS using a lowerBound,
  // then walk forward only while sn.t <= ct (active window).
  const activeSupernovas: SceneState["activeSupernovas"] = [];
  {
    const windowStart = ct - SUPERNOVA_MS;
    // lowerBound: first index i where supernovas[i].t > windowStart
    let lo = 0;
    let hi = supernovas.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (supernovas[mid].t <= windowStart) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    for (let i = lo; i < supernovas.length; i++) {
      const sn = supernovas[i];
      if (sn.t > ct) break; // past the active window
      // sn.t in (windowStart, ct] → active
      activeSupernovas.push({
        starIds: sn.starIds,
        age: (ct - sn.t) / SUPERNOVA_MS,
        magnitude: sn.magnitude,
      });
    }
  }

  // --- comet positions ---
  const cometPositions: SceneState["cometPositions"] = [];
  for (const comet of comets) {
    const { author, hops } = comet;
    if (hops.length < 2) continue; // single-hop comets never emit

    // Find which segment [hops[k], hops[k+1]) the current time falls in.
    // We want the last hop with hop.t <= ct, then check if we are before the next hop.
    // Extract hop times and binary search for efficiency.
    // We iterate (comet hops are typically short) — O(hops) per comet is fine.
    let segK = -1;
    for (let k = 0; k < hops.length - 1; k++) {
      const tk = hops[k].t;
      const tk1 = hops[k + 1].t;

      // Skip zero-length segments.
      if (tk1 === tk) continue;

      // Check if ct falls in [tk, tk1).
      if (ct >= tk && ct < tk1) {
        segK = k;
        break;
      }
    }

    if (segK === -1) continue; // before first hop or at/after last hop

    const tk = hops[segK].t;
    let tk1 = hops[segK + 1].t;
    let fromStar = hops[segK].starId;
    let toStar = hops[segK + 1].starId;

    // When we find the segment, account for any zero-length predecessor hops:
    // The fromStar should be the first non-zero-start of this effective segment.
    // Actually, re-read the spec: "treating the comet as already at the next hop"
    // means we skip the zero-length segment entirely and the effective fromStar
    // becomes the hop after the skipped segment.
    // The code above already does this correctly: we only match non-zero segments.

    const progress = (ct - tk) / (tk1 - tk);

    cometPositions.push({ author, fromStar, toStar, progress });
  }

  return {
    t: ct,
    aliveStarIds,
    sizes,
    pulses,
    activeSupernovas,
    cometPositions,
  };
}
