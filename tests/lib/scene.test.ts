import { describe, it, expect } from "vitest";
import { prepare, sceneAtTime, PULSE_MS, SUPERNOVA_MS } from "@/lib/timeline/scene";
import { buildTimeline } from "@/lib/timeline/build";
import type { Timeline, StarLife, SupernovaEvent, CometPath } from "@/lib/types";
import type { CommitTimeline } from "@/lib/types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeTimeline(overrides: Partial<Timeline> = {}): Timeline {
  return {
    stars: [],
    supernovas: [],
    comets: [],
    t0: 0,
    t1: 10000,
    dirs: [],
    starDirs: [],
    ...overrides,
  };
}

function makeStar(id: number, birth: number, death: number | null, sizeByTime: [number, number][]): StarLife {
  return { id, path: `file${id}.ts`, lang: "ts", birth, death, sizeByTime };
}

function makeCommitTimeline(commits: CommitTimeline["commits"]): CommitTimeline {
  return { repo: { name: "test-repo", source: "local" }, commits };
}

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("PULSE_MS is 1500", () => expect(PULSE_MS).toBe(1500));
  it("SUPERNOVA_MS is 2000", () => expect(SUPERNOVA_MS).toBe(2000));
});

// ---------------------------------------------------------------------------
// alive filter
// ---------------------------------------------------------------------------

describe("sceneAtTime – alive filter", () => {
  it("star alive when birth <= t and death is null", () => {
    const stars = [makeStar(0, 1000, null, [[1000, 10]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const scene = sceneAtTime(prepare(tl), 3000);
    expect(scene.aliveStarIds).toContain(0);
  });

  it("star alive when birth <= t and death > t", () => {
    const stars = [makeStar(0, 1000, 5000, [[1000, 10]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 6000 });
    const scene = sceneAtTime(prepare(tl), 3000);
    expect(scene.aliveStarIds).toContain(0);
  });

  it("star NOT alive when t < birth", () => {
    const stars = [makeStar(0, 2000, null, [[2000, 10]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const scene = sceneAtTime(prepare(tl), 1000);
    expect(scene.aliveStarIds).not.toContain(0);
  });

  it("star NOT alive when t >= death (death === t)", () => {
    const stars = [makeStar(0, 1000, 3000, [[1000, 10]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const scene = sceneAtTime(prepare(tl), 3000);
    expect(scene.aliveStarIds).not.toContain(0);
  });

  it("star NOT alive when t > death", () => {
    const stars = [makeStar(0, 1000, 3000, [[1000, 10]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const scene = sceneAtTime(prepare(tl), 4000);
    expect(scene.aliveStarIds).not.toContain(0);
  });

  it("star alive exactly at birth", () => {
    const stars = [makeStar(0, 2000, null, [[2000, 10]])];
    const tl = makeTimeline({ stars, t0: 2000, t1: 5000 });
    const scene = sceneAtTime(prepare(tl), 2000);
    expect(scene.aliveStarIds).toContain(0);
  });

  it("sizes[id] = 0 for unborn star", () => {
    const stars = [makeStar(0, 3000, null, [[3000, 100]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const scene = sceneAtTime(prepare(tl), 1500);
    expect(scene.sizes[0]).toBe(0);
  });

  it("sizes[id] = 0 for dead star", () => {
    const stars = [makeStar(0, 1000, 2000, [[1000, 100]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const scene = sceneAtTime(prepare(tl), 3000);
    expect(scene.sizes[0]).toBe(0);
  });

  it("aliveStarIds contains exactly alive stars (multiple stars)", () => {
    const stars = [
      makeStar(0, 1000, null, [[1000, 10]]),    // alive at t=3000
      makeStar(1, 2000, null, [[2000, 20]]),    // alive at t=3000
      makeStar(2, 5000, null, [[5000, 30]]),    // unborn at t=3000
      makeStar(3, 1000, 2500, [[1000, 40]]),   // dead at t=3000
    ];
    const tl = makeTimeline({ stars, t0: 1000, t1: 6000 });
    const scene = sceneAtTime(prepare(tl), 3000);
    expect(scene.aliveStarIds.slice().sort()).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// sizes
// ---------------------------------------------------------------------------

describe("sceneAtTime – sizes", () => {
  it("v=100 gives size = 1 + sqrt(100)/10 = 2.0", () => {
    const stars = [makeStar(0, 1000, null, [[1000, 100]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const scene = sceneAtTime(prepare(tl), 3000);
    expect(scene.sizes[0]).toBeCloseTo(2.0, 10);
  });

  it("v=0 gives size = 1 + sqrt(0)/10 = 1.0 (alive star with no entry yet)", () => {
    // birth == t of first entry, sample before first entry
    // birth=1000, first entry at 2000, sample at 1000 → no entry <= t → v=0 → size=1
    const stars = [makeStar(0, 1000, null, [[2000, 50]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const scene = sceneAtTime(prepare(tl), 1000);
    expect(scene.sizes[0]).toBeCloseTo(1.0, 10);
  });

  it("v=400 gives size = 1 + sqrt(400)/10 = 3.0", () => {
    const stars = [makeStar(0, 1000, null, [[1000, 400]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const scene = sceneAtTime(prepare(tl), 3000);
    expect(scene.sizes[0]).toBeCloseTo(3.0, 10);
  });

  it("step function: returns last entry <= t (not interpolated)", () => {
    // entries at t=1000 v=100, t=3000 v=300; sample at t=2000 → v=100 → size=2.0
    const stars = [makeStar(0, 1000, null, [[1000, 100], [3000, 300]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const scene = sceneAtTime(prepare(tl), 2000);
    expect(scene.sizes[0]).toBeCloseTo(2.0, 10);
  });

  it("exactly at entry t uses that entry's value", () => {
    // sample at t=3000 → v=300 → size = 1 + sqrt(300)/10
    // Float32Array precision: ~7 significant digits; use 6 decimal places
    const stars = [makeStar(0, 1000, null, [[1000, 100], [3000, 300]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const scene = sceneAtTime(prepare(tl), 3000);
    expect(scene.sizes[0]).toBeCloseTo(1 + Math.sqrt(300) / 10, 6);
  });

  it("after last entry uses last entry's value", () => {
    // sample at t=9000 → v=300 → size = 1 + sqrt(300)/10
    // Float32Array precision: ~7 significant digits; use 6 decimal places
    const stars = [makeStar(0, 1000, null, [[1000, 100], [3000, 300]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 9000);
    expect(scene.sizes[0]).toBeCloseTo(1 + Math.sqrt(300) / 10, 6);
  });

  it("multiple stars have independently correct sizes", () => {
    const stars = [
      makeStar(0, 1000, null, [[1000, 100]]), // size 2.0
      makeStar(1, 1000, null, [[1000, 225]]), // 1 + sqrt(225)/10 = 1 + 15/10 = 2.5
    ];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const scene = sceneAtTime(prepare(tl), 3000);
    expect(scene.sizes[0]).toBeCloseTo(2.0, 10);
    expect(scene.sizes[1]).toBeCloseTo(2.5, 10);
  });
});

// ---------------------------------------------------------------------------
// pulses
// ---------------------------------------------------------------------------

describe("sceneAtTime – pulses", () => {
  it("pulse = 1 exactly at touch time", () => {
    const stars = [makeStar(0, 1000, null, [[1000, 10], [3000, 20]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 3000);
    expect(scene.pulses[0]).toBeCloseTo(1.0, 10);
  });

  it("pulse = 0.5 at touch + PULSE_MS/2 (750ms after touch)", () => {
    const stars = [makeStar(0, 1000, null, [[1000, 10], [3000, 20]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 3000 + 750);
    expect(scene.pulses[0]).toBeCloseTo(0.5, 10);
  });

  it("pulse = 0 at exactly touch + PULSE_MS", () => {
    const stars = [makeStar(0, 1000, null, [[1000, 10], [3000, 20]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 3000 + PULSE_MS);
    expect(scene.pulses[0]).toBeCloseTo(0.0, 10);
  });

  it("pulse = 0 after touch + PULSE_MS has elapsed", () => {
    const stars = [makeStar(0, 1000, null, [[1000, 10], [3000, 20]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 3000 + PULSE_MS + 100);
    expect(scene.pulses[0]).toBe(0);
  });

  it("pulse = 0 when no touch has occurred yet (before first entry)", () => {
    // birth=1000, first entry at 2000; sample at 1000 → no touch yet → pulse=0
    const stars = [makeStar(0, 1000, null, [[2000, 10]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 1000);
    expect(scene.pulses[0]).toBe(0);
  });

  it("most recent touch wins when multiple touches exist", () => {
    // touches at 1000, 3000, 5000; sample at 5000 + 300 → uses touch 5000 → pulse = 1 - 300/1500 = 0.8
    // Float32Array precision: use 6 decimal places
    const stars = [makeStar(0, 1000, null, [[1000, 10], [3000, 20], [5000, 30]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 5000 + 300);
    expect(scene.pulses[0]).toBeCloseTo(1 - 300 / PULSE_MS, 6);
  });

  it("most recent touch wins: earlier pulse ignored after new touch", () => {
    // touches at 1000, 5000; sample at 5000 + 200 → uses 5000 → pulse = 1 - 200/1500
    // Float32Array precision: use 6 decimal places
    const stars = [makeStar(0, 1000, null, [[1000, 10], [5000, 20]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 5000 + 200);
    expect(scene.pulses[0]).toBeCloseTo(1 - 200 / PULSE_MS, 6);
  });

  it("pulse = 0 for unborn star", () => {
    const stars = [makeStar(0, 5000, null, [[5000, 10]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 1500);
    expect(scene.pulses[0]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// supernovas
// ---------------------------------------------------------------------------

describe("sceneAtTime – supernovas", () => {
  const sn1: SupernovaEvent = { t: 2000, starIds: [0], magnitude: 0.5, message: "c1", author: "alice" };
  const sn2: SupernovaEvent = { t: 5000, starIds: [1], magnitude: 0.8, message: "c2", author: "bob" };

  it("supernova active exactly at event t (age = 0)", () => {
    const tl = makeTimeline({ supernovas: [sn1], t0: 0, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 2000);
    expect(scene.activeSupernovas).toHaveLength(1);
    expect(scene.activeSupernovas[0].age).toBeCloseTo(0, 10);
  });

  it("supernova active partway through: age = 0.5 at event.t + SUPERNOVA_MS/2", () => {
    const tl = makeTimeline({ supernovas: [sn1], t0: 0, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 2000 + SUPERNOVA_MS / 2);
    expect(scene.activeSupernovas).toHaveLength(1);
    expect(scene.activeSupernovas[0].age).toBeCloseTo(0.5, 10);
  });

  it("supernova expired exactly at event.t + SUPERNOVA_MS", () => {
    const tl = makeTimeline({ supernovas: [sn1], t0: 0, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 2000 + SUPERNOVA_MS);
    expect(scene.activeSupernovas).toHaveLength(0);
  });

  it("supernova future: not active before event.t", () => {
    const tl = makeTimeline({ supernovas: [sn1], t0: 0, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 1999);
    expect(scene.activeSupernovas).toHaveLength(0);
  });

  it("magnitude is passed through", () => {
    const tl = makeTimeline({ supernovas: [sn1], t0: 0, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 2000);
    expect(scene.activeSupernovas[0].magnitude).toBe(0.5);
  });

  it("starIds passed through from event", () => {
    const tl = makeTimeline({ supernovas: [sn1], t0: 0, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 2000);
    expect(scene.activeSupernovas[0].starIds).toEqual([0]);
  });

  it("only active supernovas included when multiple events exist", () => {
    const tl = makeTimeline({ supernovas: [sn1, sn2], t0: 0, t1: 10000 });
    // At t=2500: sn1 is active (2000+2000>2500), sn2 is future
    const scene = sceneAtTime(prepare(tl), 2500);
    expect(scene.activeSupernovas).toHaveLength(1);
    expect(scene.activeSupernovas[0].starIds).toEqual([0]);
  });

  it("both supernovas active when t falls in overlap", () => {
    // sn1 at 2000, SUPERNOVA_MS=2000 → active until 4000
    // sn2 at 3500 → active from 3500
    const sn3: SupernovaEvent = { t: 3500, starIds: [1], magnitude: 0.9, message: "c3", author: "carol" };
    const tl = makeTimeline({ supernovas: [sn1, sn3], t0: 0, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 3600);
    expect(scene.activeSupernovas).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// comets
// ---------------------------------------------------------------------------

describe("sceneAtTime – comets", () => {
  it("comet with 2 hops: progress 0.0 at first hop t", () => {
    const comets: CometPath[] = [
      { author: "alice", hops: [{ t: 1000, starId: 0 }, { t: 3000, starId: 1 }] },
    ];
    const tl = makeTimeline({ comets, t0: 0, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 1000);
    expect(scene.cometPositions).toHaveLength(1);
    expect(scene.cometPositions[0].author).toBe("alice");
    expect(scene.cometPositions[0].fromStar).toBe(0);
    expect(scene.cometPositions[0].toStar).toBe(1);
    expect(scene.cometPositions[0].progress).toBeCloseTo(0.0, 10);
  });

  it("comet: progress 0.5 halfway between hops", () => {
    const comets: CometPath[] = [
      { author: "alice", hops: [{ t: 1000, starId: 0 }, { t: 3000, starId: 1 }] },
    ];
    const tl = makeTimeline({ comets, t0: 0, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 2000);
    expect(scene.cometPositions[0].progress).toBeCloseTo(0.5, 10);
  });

  it("comet: progress approaches 1 just before second hop", () => {
    const comets: CometPath[] = [
      { author: "alice", hops: [{ t: 1000, starId: 0 }, { t: 3000, starId: 1 }] },
    ];
    const tl = makeTimeline({ comets, t0: 0, t1: 10000 });
    // at t = t1 - 1 = 2999: progress = (2999 - 1000) / (3000 - 1000) = 1999/2000 = 0.9995
    const scene = sceneAtTime(prepare(tl), 2999);
    expect(scene.cometPositions[0].progress).toBeCloseTo(1999 / 2000, 10);
  });

  it("comet: no entry before first hop", () => {
    const comets: CometPath[] = [
      { author: "alice", hops: [{ t: 1000, starId: 0 }, { t: 3000, starId: 1 }] },
    ];
    const tl = makeTimeline({ comets, t0: 0, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 500);
    expect(scene.cometPositions.find((c) => c.author === "alice")).toBeUndefined();
  });

  it("comet: no entry at or after last hop", () => {
    const comets: CometPath[] = [
      { author: "alice", hops: [{ t: 1000, starId: 0 }, { t: 3000, starId: 1 }] },
    ];
    const tl = makeTimeline({ comets, t0: 0, t1: 10000 });
    // at t=3000: past the segment [1000,3000) → no entry
    const scene = sceneAtTime(prepare(tl), 3000);
    expect(scene.cometPositions.find((c) => c.author === "alice")).toBeUndefined();
  });

  it("single-hop comet never emits a position", () => {
    const comets: CometPath[] = [
      { author: "bob", hops: [{ t: 1000, starId: 0 }] },
    ];
    const tl = makeTimeline({ comets, t0: 0, t1: 10000 });
    const scene = sceneAtTime(prepare(tl), 1000);
    expect(scene.cometPositions.find((c) => c.author === "bob")).toBeUndefined();
  });

  it("comet with 3 hops: tracks correct segment", () => {
    const comets: CometPath[] = [
      {
        author: "carol",
        hops: [
          { t: 1000, starId: 0 },
          { t: 3000, starId: 1 },
          { t: 6000, starId: 2 },
        ],
      },
    ];
    const tl = makeTimeline({ comets, t0: 0, t1: 10000 });
    // t=4500: in segment [3000, 6000), progress = (4500-3000)/(6000-3000) = 1500/3000 = 0.5
    const scene = sceneAtTime(prepare(tl), 4500);
    expect(scene.cometPositions).toHaveLength(1);
    expect(scene.cometPositions[0].fromStar).toBe(1);
    expect(scene.cometPositions[0].toStar).toBe(2);
    expect(scene.cometPositions[0].progress).toBeCloseTo(0.5, 10);
  });

  it("zero-length segment (same-date hops) is skipped: comet moves to next segment", () => {
    // hops at t=1000 (star 0), t=1000 (star 1), t=3000 (star 2)
    // segment [1000,1000) has zero length → skip it; at t=1000, should be in [1000,3000) or no entry
    const comets: CometPath[] = [
      {
        author: "dave",
        hops: [
          { t: 1000, starId: 0 },
          { t: 1000, starId: 1 },
          { t: 3000, starId: 2 },
        ],
      },
    ];
    const tl = makeTimeline({ comets, t0: 0, t1: 10000 });
    // at t=2000: in segment [1000, 3000) (after skipping zero-length), progress = (2000-1000)/(3000-1000) = 0.5
    const scene = sceneAtTime(prepare(tl), 2000);
    const pos = scene.cometPositions.find((c) => c.author === "dave");
    expect(pos).toBeDefined();
    expect(pos!.fromStar).toBe(1);
    expect(pos!.toStar).toBe(2);
    expect(pos!.progress).toBeCloseTo(0.5, 10);
  });
});

// ---------------------------------------------------------------------------
// clamping
// ---------------------------------------------------------------------------

describe("sceneAtTime – clamping", () => {
  it("t < t0 clamps to t0: deep-equals sceneAtTime at t0", () => {
    const stars = [makeStar(0, 1000, null, [[1000, 100]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const p = prepare(tl);
    const atT0 = sceneAtTime(p, 1000);
    // We need to copy since buffers are reused
    const atT0Copy = {
      t: atT0.t,
      aliveStarIds: [...atT0.aliveStarIds],
      sizes: new Float32Array(atT0.sizes),
      pulses: new Float32Array(atT0.pulses),
      activeSupernovas: atT0.activeSupernovas.map((s) => ({ ...s, starIds: [...s.starIds] })),
      cometPositions: [...atT0.cometPositions],
    };
    const beforeT0 = sceneAtTime(p, 1000 - 99999);
    expect(beforeT0.t).toBe(atT0Copy.t);
    expect(beforeT0.aliveStarIds).toEqual(atT0Copy.aliveStarIds);
    expect(Array.from(beforeT0.sizes)).toEqual(Array.from(atT0Copy.sizes));
    expect(Array.from(beforeT0.pulses)).toEqual(Array.from(atT0Copy.pulses));
  });

  it("t > t1 clamps to t1: deep-equals sceneAtTime at t1", () => {
    const stars = [makeStar(0, 1000, null, [[1000, 100]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const p = prepare(tl);
    const atT1 = sceneAtTime(p, 5000);
    const atT1Copy = {
      t: atT1.t,
      aliveStarIds: [...atT1.aliveStarIds],
      sizes: new Float32Array(atT1.sizes),
      pulses: new Float32Array(atT1.pulses),
      activeSupernovas: atT1.activeSupernovas.map((s) => ({ ...s, starIds: [...s.starIds] })),
      cometPositions: [...atT1.cometPositions],
    };
    const afterT1 = sceneAtTime(p, 5000 + 99999);
    expect(afterT1.t).toBe(atT1Copy.t);
    expect(afterT1.aliveStarIds).toEqual(atT1Copy.aliveStarIds);
    expect(Array.from(afterT1.sizes)).toEqual(Array.from(atT1Copy.sizes));
    expect(Array.from(afterT1.pulses)).toEqual(Array.from(atT1Copy.pulses));
  });
});

// ---------------------------------------------------------------------------
// determinism
// ---------------------------------------------------------------------------

describe("sceneAtTime – determinism", () => {
  it("two calls with same t return deeply equal scalar results", () => {
    const stars = [makeStar(0, 1000, null, [[1000, 100]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const p = prepare(tl);
    const s1 = sceneAtTime(p, 3000);
    const s1snap = { t: s1.t, sizes: new Float32Array(s1.sizes), pulses: new Float32Array(s1.pulses), alive: [...s1.aliveStarIds] };
    const s2 = sceneAtTime(p, 3000);
    expect(s2.t).toBe(s1snap.t);
    expect(Array.from(s2.sizes)).toEqual(Array.from(s1snap.sizes));
    expect(Array.from(s2.pulses)).toEqual(Array.from(s1snap.pulses));
    expect(s2.aliveStarIds).toEqual(s1snap.alive);
  });

  it("prepare called twice produces the same sceneAtTime results", () => {
    const stars = [makeStar(0, 1000, null, [[1000, 100]])];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const p1 = prepare(tl);
    const p2 = prepare(tl);
    const r1 = sceneAtTime(p1, 3000);
    const r1Sizes = new Float32Array(r1.sizes);
    const r2 = sceneAtTime(p2, 3000);
    expect(r2.t).toBe(r1.t);
    expect(Array.from(r2.sizes)).toEqual(Array.from(r1Sizes));
    expect(r2.aliveStarIds).toEqual(r1.aliveStarIds);
  });
});

// ---------------------------------------------------------------------------
// performance shape – buffer reuse
// ---------------------------------------------------------------------------

describe("sceneAtTime – buffer reuse", () => {
  it("sizes Float32Array is the SAME object reference across two calls (reuse contract)", () => {
    const stars = [
      makeStar(0, 1000, null, [[1000, 100]]),
      makeStar(1, 1000, null, [[1000, 200]]),
    ];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const p = prepare(tl);
    const r1 = sceneAtTime(p, 2000);
    const sizesRef = r1.sizes;
    const r2 = sceneAtTime(p, 3000);
    expect(r2.sizes).toBe(sizesRef);
  });

  it("pulses Float32Array is the SAME object reference across two calls (reuse contract)", () => {
    const stars = [
      makeStar(0, 1000, null, [[1000, 100]]),
      makeStar(1, 1000, null, [[1000, 200]]),
    ];
    const tl = makeTimeline({ stars, t0: 1000, t1: 5000 });
    const p = prepare(tl);
    const r1 = sceneAtTime(p, 2000);
    const pulsesRef = r1.pulses;
    const r2 = sceneAtTime(p, 3000);
    expect(r2.pulses).toBe(pulsesRef);
  });
});

// ---------------------------------------------------------------------------
// binary search correctness (large sizeByTime)
// ---------------------------------------------------------------------------

describe("sceneAtTime – binary search correctness (1000 entries)", () => {
  // Build a star with 1000 entries: t=1000,2000,...,1000000; v=t (cumulative = i*100 at entry i)
  const N = 1000;
  const entries: [number, number][] = [];
  for (let i = 1; i <= N; i++) {
    entries.push([i * 1000, i * 100]);
  }
  const star = makeStar(0, 1000, null, entries);
  const tl = makeTimeline({ stars: [star], t0: 1000, t1: 1_500_000 });
  const p = prepare(tl);

  it("before first entry (t=1000 but no entry before t=1000 since birth==firstEntry): v = 100 (first entry is at t=1000)", () => {
    // First entry is at t=1000, sample at exactly t=1000 → v=100 → size = 1 + sqrt(100)/10 = 2.0
    const scene = sceneAtTime(p, 1000);
    expect(scene.sizes[0]).toBeCloseTo(2.0, 10);
  });

  it("between two entries uses the earlier one (step function)", () => {
    // entry 500 at t=500000 v=50000; entry 501 at t=501000 v=50100; sample at t=500500 → v=50000
    // Float32Array precision: use 5 decimal places (Float32 has ~7 significant digits)
    const scene = sceneAtTime(p, 500500);
    expect(scene.sizes[0]).toBeCloseTo(1 + Math.sqrt(50000) / 10, 5);
  });

  it("exactly at entry t=500000 uses that entry's v=50000", () => {
    const scene = sceneAtTime(p, 500000);
    expect(scene.sizes[0]).toBeCloseTo(1 + Math.sqrt(50000) / 10, 5);
  });

  it("after last entry (t > 1000000) uses last entry v=100000", () => {
    const scene = sceneAtTime(p, 1_200_000);
    expect(scene.sizes[0]).toBeCloseTo(1 + Math.sqrt(100000) / 10, 5);
  });

  it("before first entry with birth < first entry t → v=0, size=1.0", () => {
    // star born at t=500, first entry at t=1000; sample at t=500 → no entry <= 500 → v=0 → size=1.0
    const star2 = makeStar(1, 500, null, [[1000, 100]]);
    const tl2 = makeTimeline({ stars: [star, star2], t0: 500, t1: 1_500_000 });
    const p2 = prepare(tl2);
    const scene = sceneAtTime(p2, 500);
    expect(scene.sizes[1]).toBeCloseTo(1.0, 10);
  });
});

// ---------------------------------------------------------------------------
// empty timeline
// ---------------------------------------------------------------------------

describe("sceneAtTime – empty timeline", () => {
  it("empty Timeline literal: empty aliveStarIds, zero-length typed arrays, no events", () => {
    const tl = makeTimeline({ stars: [], supernovas: [], comets: [], t0: 0, t1: 0 });
    const scene = sceneAtTime(prepare(tl), 0);
    expect(scene.aliveStarIds).toHaveLength(0);
    expect(scene.sizes).toHaveLength(0);
    expect(scene.pulses).toHaveLength(0);
    expect(scene.activeSupernovas).toHaveLength(0);
    expect(scene.cometPositions).toHaveLength(0);
  });

  it("buildTimeline of empty input then prepare/sceneAtTime: no crash, empty results", () => {
    const tl = buildTimeline({ repo: { name: "r", source: "local" }, commits: [] });
    const scene = sceneAtTime(prepare(tl), 0);
    expect(scene.aliveStarIds).toHaveLength(0);
    expect(scene.sizes).toHaveLength(0);
    expect(scene.pulses).toHaveLength(0);
    expect(scene.activeSupernovas).toHaveLength(0);
    expect(scene.cometPositions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// integration: real buildTimeline output
// ---------------------------------------------------------------------------

describe("sceneAtTime – integration with real buildTimeline", () => {
  it("3-commit timeline produces expected full SceneState", () => {
    // 3 commits:
    //   c1 at t=1000: alice adds a.ts delta=100 → star0 born, sizeByTime=[[1000,100]]
    //   c2 at t=3000: alice adds b.ts delta=400 → star1 born, sizeByTime=[[3000,400]]
    //   c3 at t=5000: alice modifies a.ts delta=100 → star0 sizeByTime=[[1000,100],[5000,200]]
    const input = makeCommitTimeline([
      { hash: "c1", author: "alice", date: 1000, message: "add a", changes: [{ path: "a.ts", type: "add", delta: 100 }] },
      { hash: "c2", author: "alice", date: 3000, message: "add b", changes: [{ path: "b.ts", type: "add", delta: 400 }] },
      { hash: "c3", author: "alice", date: 5000, message: "mod a", changes: [{ path: "a.ts", type: "modify", delta: 100 }] },
    ]);
    const tl = buildTimeline(input);
    const p = prepare(tl);

    // Sample at t=4000: between c2 and c3
    // star0 (a.ts): alive, last sizeByTime entry <= 4000 is [1000,100] → v=100 → size=2.0
    // star1 (b.ts): alive, last entry <= 4000 is [3000,400] → v=400 → size=1+sqrt(400)/10=3.0
    // pulses: star0 last touch=1000, elapsed=3000 > PULSE_MS → 0
    //         star1 last touch=3000, elapsed=1000 → pulse = 1 - 1000/1500 ≈ 0.333...
    // supernova c2 (t=3000): active until 5000 → at t=4000 age = (4000-3000)/2000 = 0.5
    // supernova c1 (t=1000): active until 3000 → expired at t=4000
    // supernova c3 (t=5000): future
    const scene = sceneAtTime(p, 4000);

    expect(scene.t).toBe(4000);
    expect(scene.aliveStarIds.slice().sort()).toEqual([0, 1]);
    expect(scene.sizes[0]).toBeCloseTo(2.0, 10);
    expect(scene.sizes[1]).toBeCloseTo(3.0, 10);
    expect(scene.pulses[0]).toBe(0);
    // Float32Array precision: use 6 decimal places
    expect(scene.pulses[1]).toBeCloseTo(1 - 1000 / PULSE_MS, 6);

    // Only c2's supernova (t=3000) is active at t=4000
    const activeSns = scene.activeSupernovas;
    expect(activeSns).toHaveLength(1);
    expect(activeSns[0].age).toBeCloseTo(0.5, 10);

    // alice comet: hops at 1000 (star0), 3000 (star1), 5000 (star0)
    // at t=4000: in segment [3000, 5000), progress = (4000-3000)/(5000-3000) = 0.5
    const cometPos = scene.cometPositions.find((c) => c.author === "alice");
    expect(cometPos).toBeDefined();
    expect(cometPos!.fromStar).toBe(1); // star1 (b.ts)
    expect(cometPos!.toStar).toBe(0);  // star0 (a.ts)
    expect(cometPos!.progress).toBeCloseTo(0.5, 10);
  });
});
