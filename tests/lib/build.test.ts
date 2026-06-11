import { describe, it, expect } from "vitest";
import { buildTimeline, dirOf, MAX_STARS } from "@/lib/timeline/build";
import type { CommitTimeline } from "@/lib/types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function makeTimeline(commits: CommitTimeline["commits"]): CommitTimeline {
  return { repo: { name: "test-repo", source: "local" }, commits };
}

// ---------------------------------------------------------------------------
// dirOf
// ---------------------------------------------------------------------------
describe("dirOf", () => {
  it("returns parent dir for nested path", () => expect(dirOf("a/b/c.ts")).toBe("a/b"));
  it("returns '' for root-level file", () => expect(dirOf("c.ts")).toBe(""));
  it("returns '' for bare filename", () => expect(dirOf("README.md")).toBe(""));
  it("returns one level for shallow path", () => expect(dirOf("src/index.ts")).toBe("src"));
  it("handles deeply nested path", () => expect(dirOf("a/b/c/d/e.go")).toBe("a/b/c/d"));
});

// ---------------------------------------------------------------------------
// empty input
// ---------------------------------------------------------------------------
describe("buildTimeline – empty input", () => {
  it("returns all-empty arrays and t0 === t1 === 0", () => {
    const tl = buildTimeline(makeTimeline([]));
    expect(tl.stars).toHaveLength(0);
    expect(tl.supernovas).toHaveLength(0);
    expect(tl.comets).toHaveLength(0);
    expect(tl.t0).toBe(0);
    expect(tl.t1).toBe(0);
    expect(tl.dirs).toHaveLength(0);
    expect(tl.starDirs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// single commit – star birth
// ---------------------------------------------------------------------------
describe("buildTimeline – single commit adds", () => {
  const input = makeTimeline([
    {
      hash: "aaa",
      author: "alice",
      date: 1000,
      message: "initial",
      changes: [
        { path: "src/index.ts", type: "add", delta: 100 },
        { path: "src/style.css", type: "add", delta: 50 },
      ],
    },
  ]);

  it("creates two stars", () => {
    const tl = buildTimeline(input);
    expect(tl.stars).toHaveLength(2);
  });

  it("assigns stable ids 0 and 1", () => {
    const tl = buildTimeline(input);
    expect(tl.stars[0].id).toBe(0);
    expect(tl.stars[1].id).toBe(1);
  });

  it("sets birth to commit date", () => {
    const tl = buildTimeline(input);
    expect(tl.stars[0].birth).toBe(1000);
    expect(tl.stars[1].birth).toBe(1000);
  });

  it("death is null", () => {
    const tl = buildTimeline(input);
    expect(tl.stars[0].death).toBeNull();
    expect(tl.stars[1].death).toBeNull();
  });

  it("sizeByTime reflects abs(delta) cumulatively", () => {
    const tl = buildTimeline(input);
    expect(tl.stars[0].sizeByTime).toEqual([[1000, 100]]);
    expect(tl.stars[1].sizeByTime).toEqual([[1000, 50]]);
  });

  it("lang is detected", () => {
    const tl = buildTimeline(input);
    expect(tl.stars[0].lang).toBe("ts");
    expect(tl.stars[1].lang).toBe("css");
  });

  it("t0 and t1 equal commit date", () => {
    const tl = buildTimeline(input);
    expect(tl.t0).toBe(1000);
    expect(tl.t1).toBe(1000);
  });

  it("dirs contains 'src' once", () => {
    const tl = buildTimeline(input);
    expect(tl.dirs).toEqual(["src"]);
  });

  it("starDirs maps both stars to dir index 0", () => {
    const tl = buildTimeline(input);
    expect(tl.starDirs).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------------------
// modify – size accumulates
// ---------------------------------------------------------------------------
describe("buildTimeline – modify accumulates size", () => {
  const input = makeTimeline([
    {
      hash: "a",
      author: "bob",
      date: 1000,
      message: "add",
      changes: [{ path: "a.ts", type: "add", delta: 10 }],
    },
    {
      hash: "b",
      author: "bob",
      date: 2000,
      message: "modify",
      changes: [{ path: "a.ts", type: "modify", delta: -5 }], // negative delta: abs = 5
    },
    {
      hash: "c",
      author: "bob",
      date: 3000,
      message: "modify2",
      changes: [{ path: "a.ts", type: "modify", delta: 20 }],
    },
  ]);

  it("sizeByTime is monotonically nondecreasing", () => {
    const tl = buildTimeline(input);
    const s = tl.stars[0].sizeByTime;
    expect(s).toHaveLength(3);
    expect(s[0]).toEqual([1000, 10]);
    expect(s[1]).toEqual([2000, 15]); // 10 + abs(-5)
    expect(s[2]).toEqual([3000, 35]); // 15 + 20
  });
});

// ---------------------------------------------------------------------------
// modify of unseen file creates star (birth on modify)
// ---------------------------------------------------------------------------
describe("buildTimeline – modify of unseen file creates star", () => {
  const input = makeTimeline([
    {
      hash: "x",
      author: "carol",
      date: 5000,
      message: "mod unknown",
      changes: [{ path: "ghost.rs", type: "modify", delta: 7 }],
    },
  ]);

  it("creates a star on modify", () => {
    const tl = buildTimeline(input);
    expect(tl.stars).toHaveLength(1);
    expect(tl.stars[0].path).toBe("ghost.rs");
    expect(tl.stars[0].birth).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// delete sets death
// ---------------------------------------------------------------------------
describe("buildTimeline – delete sets death", () => {
  const input = makeTimeline([
    {
      hash: "a",
      author: "d",
      date: 1000,
      message: "add",
      changes: [{ path: "f.go", type: "add", delta: 10 }],
    },
    {
      hash: "b",
      author: "d",
      date: 2000,
      message: "del",
      changes: [{ path: "f.go", type: "delete", delta: 0 }],
    },
  ]);

  it("death is set to delete commit date", () => {
    const tl = buildTimeline(input);
    expect(tl.stars[0].death).toBe(2000);
  });

  it("star still exists in array", () => {
    const tl = buildTimeline(input);
    expect(tl.stars).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// delete then re-add creates new star
// ---------------------------------------------------------------------------
describe("buildTimeline – delete then re-add creates new star", () => {
  const input = makeTimeline([
    {
      hash: "a",
      author: "e",
      date: 1000,
      message: "add",
      changes: [{ path: "f.ts", type: "add", delta: 20 }],
    },
    {
      hash: "b",
      author: "e",
      date: 2000,
      message: "del",
      changes: [{ path: "f.ts", type: "delete", delta: 0 }],
    },
    {
      hash: "c",
      author: "e",
      date: 3000,
      message: "re-add",
      changes: [{ path: "f.ts", type: "add", delta: 15 }],
    },
  ]);

  it("two stars for same path", () => {
    const tl = buildTimeline(input);
    expect(tl.stars).toHaveLength(2);
  });

  it("first star has death, second has null", () => {
    const tl = buildTimeline(input);
    expect(tl.stars[0].death).toBe(2000);
    expect(tl.stars[1].death).toBeNull();
  });

  it("second star has new id", () => {
    const tl = buildTimeline(input);
    expect(tl.stars[0].id).toBe(0);
    expect(tl.stars[1].id).toBe(1);
  });

  it("second star birth is re-add date", () => {
    const tl = buildTimeline(input);
    expect(tl.stars[1].birth).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// rename: same star id, path updated, no death
// ---------------------------------------------------------------------------
describe("buildTimeline – rename", () => {
  const input = makeTimeline([
    {
      hash: "a",
      author: "f",
      date: 1000,
      message: "add",
      changes: [{ path: "old/file.ts", type: "add", delta: 30 }],
    },
    {
      hash: "b",
      author: "f",
      date: 2000,
      message: "mv",
      changes: [{ path: "old/file.ts", type: "rename", delta: 0, toPath: "new/file.ts" }],
    },
  ]);

  it("still one star after rename", () => {
    const tl = buildTimeline(input);
    expect(tl.stars).toHaveLength(1);
  });

  it("star path updated to toPath", () => {
    const tl = buildTimeline(input);
    expect(tl.stars[0].path).toBe("new/file.ts");
  });

  it("no death set on rename", () => {
    const tl = buildTimeline(input);
    expect(tl.stars[0].death).toBeNull();
  });

  it("same star id (0) after rename", () => {
    const tl = buildTimeline(input);
    expect(tl.stars[0].id).toBe(0);
  });

  it("starDirs updated to new dir index", () => {
    const tl = buildTimeline(input);
    // dirs: first-seen: "old" at 0, then "new" at 1
    expect(tl.dirs).toContain("new");
    const newDirIdx = tl.dirs.indexOf("new");
    expect(tl.starDirs[0]).toBe(newDirIdx);
  });
});

// ---------------------------------------------------------------------------
// supernovas
// ---------------------------------------------------------------------------
describe("buildTimeline – supernovas", () => {
  const input = makeTimeline([
    {
      hash: "c1",
      author: "g",
      date: 1000,
      message: "big commit",
      changes: [
        { path: "a.ts", type: "add", delta: 100 },
        { path: "b.ts", type: "add", delta: 200 },
        { path: "a.ts", type: "modify", delta: 50 }, // same star touched twice
      ],
    },
    {
      hash: "c2",
      author: "g",
      date: 2000,
      message: "small",
      changes: [{ path: "c.ts", type: "add", delta: 1 }],
    },
  ]);

  it("exactly one supernova per commit", () => {
    const tl = buildTimeline(input);
    expect(tl.supernovas).toHaveLength(2);
  });

  it("supernova t equals commit date", () => {
    const tl = buildTimeline(input);
    expect(tl.supernovas[0].t).toBe(1000);
    expect(tl.supernovas[1].t).toBe(2000);
  });

  it("supernova starIds are deduped in change order", () => {
    const tl = buildTimeline(input);
    // a.ts=id0, b.ts=id1; a.ts again -> deduped; result [0,1]
    expect(tl.supernovas[0].starIds).toEqual([0, 1]);
  });

  it("supernova magnitude for c1: log10(1+350)/4", () => {
    const tl = buildTimeline(input);
    const expected = Math.min(1, Math.log10(1 + 350) / 4);
    expect(tl.supernovas[0].magnitude).toBeCloseTo(expected, 10);
  });

  it("supernova magnitude capped at 1", () => {
    // totalAbsDelta that gives log10(1+x)/4 > 1: x > 10^4-1 = 9999
    const bigInput = makeTimeline([
      {
        hash: "big",
        author: "h",
        date: 1,
        message: "huge",
        changes: [{ path: "x.ts", type: "add", delta: 100_000 }],
      },
    ]);
    const tl = buildTimeline(bigInput);
    expect(tl.supernovas[0].magnitude).toBe(1);
  });

  it("message and author copied to supernova", () => {
    const tl = buildTimeline(input);
    expect(tl.supernovas[0].message).toBe("big commit");
    expect(tl.supernovas[0].author).toBe("g");
  });
});

// ---------------------------------------------------------------------------
// comets
// ---------------------------------------------------------------------------
describe("buildTimeline – comets", () => {
  const input = makeTimeline([
    {
      hash: "a",
      author: "alice",
      date: 1000,
      message: "m1",
      changes: [{ path: "x.ts", type: "add", delta: 10 }],
    },
    {
      hash: "b",
      author: "bob",
      date: 2000,
      message: "m2",
      changes: [{ path: "y.ts", type: "add", delta: 5 }],
    },
    {
      hash: "c",
      author: "alice",
      date: 3000,
      message: "m3",
      changes: [{ path: "z.ts", type: "add", delta: 20 }],
    },
  ]);

  it("one CometPath per distinct author", () => {
    const tl = buildTimeline(input);
    expect(tl.comets).toHaveLength(2);
  });

  it("alice has 2 hops in date order", () => {
    const tl = buildTimeline(input);
    const alice = tl.comets.find((c) => c.author === "alice")!;
    expect(alice.hops).toHaveLength(2);
    expect(alice.hops[0].t).toBe(1000);
    expect(alice.hops[1].t).toBe(3000);
  });

  it("hop starId is first touched star of that commit", () => {
    const tl = buildTimeline(input);
    const alice = tl.comets.find((c) => c.author === "alice")!;
    // commit a: first star x.ts=0; commit c: first star z.ts=2
    expect(alice.hops[0].starId).toBe(0);
    expect(alice.hops[1].starId).toBe(2);
  });

  it("bob has 1 hop", () => {
    const tl = buildTimeline(input);
    const bob = tl.comets.find((c) => c.author === "bob")!;
    expect(bob.hops).toHaveLength(1);
    expect(bob.hops[0].starId).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// t0 / t1
// ---------------------------------------------------------------------------
describe("buildTimeline – t0/t1", () => {
  it("t0 = first commit date, t1 = last commit date", () => {
    const input = makeTimeline([
      { hash: "a", author: "x", date: 100, message: "a", changes: [] },
      { hash: "b", author: "x", date: 999, message: "b", changes: [] },
    ]);
    const tl = buildTimeline(input);
    expect(tl.t0).toBe(100);
    expect(tl.t1).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// dirs first-seen order
// ---------------------------------------------------------------------------
describe("buildTimeline – dirs ordering", () => {
  it("dirs are in first-seen order across commits", () => {
    const input = makeTimeline([
      {
        hash: "a",
        author: "x",
        date: 1,
        message: "m",
        changes: [
          { path: "beta/a.ts", type: "add", delta: 1 },
          { path: "alpha/b.ts", type: "add", delta: 1 },
        ],
      },
      {
        hash: "b",
        author: "x",
        date: 2,
        message: "m",
        changes: [{ path: "gamma/c.ts", type: "add", delta: 1 }],
      },
    ]);
    const tl = buildTimeline(input);
    expect(tl.dirs).toEqual(["beta", "alpha", "gamma"]);
  });

  it("root-level files get dir '' which is included in dirs", () => {
    const input = makeTimeline([
      {
        hash: "a",
        author: "x",
        date: 1,
        message: "m",
        changes: [{ path: "README.md", type: "add", delta: 1 }],
      },
    ]);
    const tl = buildTimeline(input);
    expect(tl.dirs).toContain("");
    expect(tl.starDirs[0]).toBe(tl.dirs.indexOf(""));
  });
});

// ---------------------------------------------------------------------------
// determinism
// ---------------------------------------------------------------------------
describe("buildTimeline – determinism", () => {
  it("same input produces deeply equal output", () => {
    const input = makeTimeline([
      {
        hash: "a",
        author: "x",
        date: 1,
        message: "m",
        changes: [{ path: "f.ts", type: "add", delta: 10 }],
      },
    ]);
    const r1 = buildTimeline(input);
    const r2 = buildTimeline(input);
    expect(r1).toEqual(r2);
  });
});

// ---------------------------------------------------------------------------
// starId validity
// ---------------------------------------------------------------------------
describe("buildTimeline – starId validity", () => {
  it("all starIds in supernovas are < stars.length", () => {
    const input = makeTimeline([
      {
        hash: "a",
        author: "x",
        date: 1,
        message: "m",
        changes: [
          { path: "a.ts", type: "add", delta: 5 },
          { path: "b.ts", type: "add", delta: 5 },
        ],
      },
    ]);
    const tl = buildTimeline(input);
    for (const sn of tl.supernovas) {
      for (const id of sn.starIds) {
        expect(id).toBeLessThan(tl.stars.length);
      }
    }
  });

  it("all starIds in comets are < stars.length", () => {
    const input = makeTimeline([
      {
        hash: "a",
        author: "x",
        date: 1,
        message: "m",
        changes: [{ path: "a.ts", type: "add", delta: 5 }],
      },
    ]);
    const tl = buildTimeline(input);
    for (const comet of tl.comets) {
      for (const hop of comet.hops) {
        expect(hop.starId).toBeLessThan(tl.stars.length);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// aggregation: > MAX_STARS collapses to <= MAX_STARS, mass preserved
// ---------------------------------------------------------------------------
describe("buildTimeline – aggregation", () => {
  it("16000 files across 100 dirs yields <= MAX_STARS and preserves total mass", () => {
    // Build 16000 commits each adding a unique file in one of 100 dirs
    const TOTAL = 16_000;
    const DIR_COUNT = 100;
    const commits: CommitTimeline["commits"] = [];
    for (let i = 0; i < TOTAL; i++) {
      const dir = `dir${i % DIR_COUNT}`;
      commits.push({
        hash: `h${i}`,
        author: "bot",
        date: i + 1,
        message: `add ${i}`,
        changes: [{ path: `${dir}/file${i}.ts`, type: "add", delta: 1 }],
      });
    }

    const tl = buildTimeline(makeTimeline(commits));

    expect(tl.stars.length).toBeLessThanOrEqual(MAX_STARS);

    // Total cumulative mass = sum of last sizeByTime entry per star
    const totalMass = tl.stars.reduce((acc, s) => {
      const last = s.sizeByTime[s.sizeByTime.length - 1];
      return acc + (last ? last[1] : 0);
    }, 0);
    expect(totalMass).toBe(TOTAL); // each file added delta=1
  }, 30_000); // allow 30s for this heavier test

  it("all starIds referenced in supernovas are valid after aggregation", () => {
    const TOTAL = 16_000;
    const DIR_COUNT = 100;
    const commits: CommitTimeline["commits"] = [];
    for (let i = 0; i < TOTAL; i++) {
      const dir = `dir${i % DIR_COUNT}`;
      commits.push({
        hash: `h${i}`,
        author: "bot",
        date: i + 1,
        message: `add ${i}`,
        changes: [{ path: `${dir}/file${i}.ts`, type: "add", delta: 1 }],
      });
    }
    const tl = buildTimeline(makeTimeline(commits));
    for (const sn of tl.supernovas) {
      for (const id of sn.starIds) {
        expect(id).toBeGreaterThanOrEqual(0);
        expect(id).toBeLessThan(tl.stars.length);
      }
    }
  }, 30_000);
});
