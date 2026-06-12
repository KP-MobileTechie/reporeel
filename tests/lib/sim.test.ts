import { describe, it, expect } from "vitest";
import { mulberry32 } from "@/lib/layout/prng";
import {
  CLUSTER_RADIUS,
  MAX_DT,
  computeAnchors,
  initPositions,
  step,
} from "@/lib/layout/sim";

// ── prng.ts tests ─────────────────────────────────────────────────────────────

describe("mulberry32", () => {
  it("same seed produces the same first 5 floats (exact values)", () => {
    const rand = mulberry32(42);
    const vals = [rand(), rand(), rand(), rand(), rand()];
    // Reference values captured from a canonical Node.js run.
    expect(vals[0]).toBeCloseTo(0.6011037519201636, 15);
    expect(vals[1]).toBeCloseTo(0.44829055899754167, 15);
    expect(vals[2]).toBeCloseTo(0.8524657934904099, 15);
    expect(vals[3]).toBeCloseTo(0.6697340414393693, 15);
    expect(vals[4]).toBeCloseTo(0.17481389874592423, 15);
  });

  it("different seeds produce different sequences", () => {
    const rand42 = mulberry32(42);
    const rand99 = mulberry32(99);
    const v42 = [rand42(), rand42(), rand42()];
    const v99 = [rand99(), rand99(), rand99()];
    expect(v42).not.toEqual(v99);
  });

  it("all outputs are in [0, 1)", () => {
    const rand = mulberry32(12345);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ── sim.ts: initPositions tests ───────────────────────────────────────────────

describe("initPositions", () => {
  it("returns a Float32Array of length 2 * starDirs.length", () => {
    const starDirs = [0, 1, 0, 2, 1];
    const result = initPositions(starDirs, 3, 7);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(2 * starDirs.length);
  });

  it("same inputs produce byte-identical arrays (determinism)", () => {
    const starDirs = [0, 0, 1, 1, 2, 0, 2, 1];
    const a = initPositions(starDirs, 3, 42);
    const b = initPositions(starDirs, 3, 42);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("each star is within CLUSTER_RADIUS of its directory anchor", () => {
    const dirCount = 5;
    const seed = 77;
    // Build starDirs with a variety of dir assignments
    const starDirs: number[] = [];
    for (let i = 0; i < 20; i++) starDirs.push(i % dirCount);

    const anchors = computeAnchors(dirCount, seed);
    const positions = initPositions(starDirs, dirCount, seed);

    for (let i = 0; i < starDirs.length; i++) {
      const dir = starDirs[i];
      const ax = anchors[2 * dir];
      const ay = anchors[2 * dir + 1];
      const dx = positions[2 * i] - ax;
      const dy = positions[2 * i + 1] - ay;
      const dist = Math.sqrt(dx * dx + dy * dy);
      expect(dist).toBeLessThanOrEqual(CLUSTER_RADIUS);
    }
  });

  it("different seeds produce different positions", () => {
    const starDirs = [0, 1, 2, 0, 1];
    const a = initPositions(starDirs, 3, 1);
    const b = initPositions(starDirs, 3, 2);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

// ── sim.ts: computeAnchors tests ──────────────────────────────────────────────

describe("computeAnchors", () => {
  it("returns Float32Array of length 2 * dirCount", () => {
    const anchors = computeAnchors(8, 0);
    expect(anchors).toBeInstanceOf(Float32Array);
    expect(anchors.length).toBe(16);
  });

  it("is deterministic", () => {
    const a = computeAnchors(10, 55);
    const b = computeAnchors(10, 55);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

// ── sim.ts: step tests ────────────────────────────────────────────────────────

/** Build a synthetic test scenario with N stars across D dirs, seeded. */
function buildScenario(n: number, d: number, seed: number) {
  const rand = mulberry32(seed);
  const starDirs = Array.from({ length: n }, () =>
    Math.floor(rand() * d)
  );
  const positions = initPositions(starDirs, d, seed);
  const velocities = new Float32Array(2 * n);
  const anchors = computeAnchors(d, seed);
  return { starDirs, positions, velocities, anchors };
}

/** Run `steps` iterations of step() with dt=16, returning a copy of positions. */
function runSim(
  starDirs: number[],
  positions: Float32Array,
  velocities: Float32Array,
  anchors: Float32Array,
  steps: number,
  dt = 16
): Float32Array {
  for (let i = 0; i < steps; i++) {
    step(positions, velocities, starDirs, anchors, dt);
  }
  return new Float32Array(positions); // return a copy
}

describe("step — determinism", () => {
  it("1000 stars, 30 dirs, 200 steps → identical results on two fresh runs", () => {
    const N = 1000;
    const D = 30;
    const SEED = 123;
    const STEPS = 200;

    const s1 = buildScenario(N, D, SEED);
    const result1 = runSim(
      s1.starDirs,
      s1.positions,
      s1.velocities,
      s1.anchors,
      STEPS
    );

    // Re-build from scratch — completely independent arrays
    const s2 = buildScenario(N, D, SEED);
    const result2 = runSim(
      s2.starDirs,
      s2.positions,
      s2.velocities,
      s2.anchors,
      STEPS
    );

    expect(Array.from(result1)).toEqual(Array.from(result2));
  });
});

describe("step — stability", () => {
  it("no NaN or Infinity after 200 steps", () => {
    const { starDirs, positions, velocities, anchors } = buildScenario(
      200,
      10,
      7
    );
    for (let i = 0; i < 200; i++) {
      step(positions, velocities, starDirs, anchors, 16);
    }
    for (let i = 0; i < positions.length; i++) {
      expect(Number.isFinite(positions[i])).toBe(true);
    }
    for (let i = 0; i < velocities.length; i++) {
      expect(Number.isFinite(velocities[i])).toBe(true);
    }
  });
});

describe("step — clustering", () => {
  it("same-dir pairs are closer together than different-dir pairs after 200 steps", () => {
    const N = 300;
    const D = 10;
    const SEED = 88;
    const STEPS = 200;

    const { starDirs, positions, velocities, anchors } = buildScenario(
      N,
      D,
      SEED
    );
    for (let i = 0; i < STEPS; i++) {
      step(positions, velocities, starDirs, anchors, 16);
    }

    // Seeded sampling of 200 same-dir pairs and 200 different-dir pairs
    const rand = mulberry32(999);
    let sameDirTotal = 0;
    let sameDirCount = 0;
    let diffDirTotal = 0;
    let diffDirCount = 0;
    const SAMPLES = 200;

    for (let s = 0; s < SAMPLES * 2; s++) {
      const i = Math.floor(rand() * N);
      const j = Math.floor(rand() * N);
      if (i === j) continue;

      const dx = positions[2 * i] - positions[2 * j];
      const dy = positions[2 * i + 1] - positions[2 * j + 1];
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (starDirs[i] === starDirs[j]) {
        sameDirTotal += dist;
        sameDirCount++;
      } else {
        diffDirTotal += dist;
        diffDirCount++;
      }

      if (sameDirCount >= SAMPLES && diffDirCount >= SAMPLES) break;
    }

    const meanSame = sameDirCount > 0 ? sameDirTotal / sameDirCount : 0;
    const meanDiff = diffDirCount > 0 ? diffDirTotal / diffDirCount : 0;

    expect(meanSame).toBeLessThan(meanDiff);
  });
});

describe("step — dt clamp", () => {
  it("dt=10000 produces the same result as dt=MAX_DT", () => {
    const { starDirs, positions: p1, velocities: v1, anchors } = buildScenario(
      50,
      5,
      42
    );
    // Make a second identical copy
    const p2 = new Float32Array(p1);
    const v2 = new Float32Array(v1);

    step(p1, v1, starDirs, anchors, 10000);
    step(p2, v2, starDirs, anchors, MAX_DT);

    expect(Array.from(p1)).toEqual(Array.from(p2));
    expect(Array.from(v1)).toEqual(Array.from(v2));
  });
});

describe("step — zero stars", () => {
  it("does not throw on empty arrays", () => {
    const positions = new Float32Array(0);
    const velocities = new Float32Array(0);
    const anchors = new Float32Array(0);
    const starDirs: number[] = [];
    expect(() => step(positions, velocities, starDirs, anchors, 16)).not.toThrow();
  });
});
