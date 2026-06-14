import { describe, it, expect } from "vitest";
import type { CommitTimeline, Commit } from "@/lib/types";
import { roleOf, isTestPath, isGeneratedPath } from "@/lib/insights/fileRoles";
import { detectTechStack } from "@/lib/insights/techStack";
import { aggregate, topDir } from "@/lib/insights/aggregate";
import { rankKeyFiles } from "@/lib/insights/keyFiles";
import { buildModules } from "@/lib/insights/architecture";
import { detectEras } from "@/lib/insights/eras";
import { buildNarration, activeBeat } from "@/lib/insights/narration";
import { buildBrief } from "@/lib/insights/brief";
import { buildReadingPath } from "@/lib/insights/onboarding";
import { analyzeRisk } from "@/lib/insights/risk";
import { detectCoupling } from "@/lib/insights/coupling";
import { analyzeActivity, classifyCommit } from "@/lib/insights/activity";
import { squarify, buildTreemap } from "@/lib/insights/treemap";
import { scoreHealth } from "@/lib/insights/health";
import { detectProjectType } from "@/lib/insights/projectType";
import { buildFileTree, buildSunburst } from "@/lib/insights/tree";
import { answerQuery } from "@/lib/insights/ask";
import { analyzeTeam } from "@/lib/insights/team";
import { healthFromCommits, computeHealthTrend } from "@/lib/insights/healthTrend";
import { applyScenario } from "@/lib/insights/simulate";
import { analyzeCulture } from "@/lib/insights/culture";
import { detectEvents } from "@/lib/insights/events";
import { computeMetrics } from "@/lib/insights/metrics";
import { detectReleases } from "@/lib/insights/release";
import { detectConventions } from "@/lib/insights/conventions";
import { suggestFirstFiles } from "@/lib/insights/firstFiles";
import { buildGlossary } from "@/lib/insights/glossary";
import { buildGroundedPrompt, briefContext, extractTextDeltas, extractGeminiTextDeltas, pickProvider } from "@/lib/ai/copilot";
import { parseImports, resolveImport, normalizePath } from "@/lib/insights/imports";
import { buildDepGraph } from "@/lib/insights/depGraph";
import { briefToMarkdown } from "@/lib/insights/markdown";
import { buildModules as buildMods } from "@/lib/insights/architecture";
import { rankKeyFiles as rankKF } from "@/lib/insights/keyFiles";
import { wrapText, titleCardOpacity } from "@/lib/export/overlay";

// ---------------------------------------------------------------------------
// A synthetic Next.js-shaped repo: enough variety to exercise every inference.
// ---------------------------------------------------------------------------
const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

function ch(path: string, type: Commit["changes"][number]["type"], delta: number, toPath?: string) {
  return toPath ? { path, type, delta, toPath } : { path, type, delta };
}

function makeRepo(): CommitTimeline {
  const commits: Commit[] = [
    { hash: "a1", author: "Ada", date: T0 + 0 * DAY, message: "scaffold next app", changes: [
      ch("package.json", "add", 30), ch("next.config.ts", "add", 10),
      ch("tsconfig.json", "add", 8), ch("app/layout.tsx", "add", 25), ch("app/page.tsx", "add", 60),
    ]},
    { hash: "a2", author: "Ada", date: T0 + 5 * DAY, message: "build the engine core", changes: [
      ch("engine/renderer.ts", "add", 220), ch("engine/shaders.ts", "add", 120), ch("lib/types.ts", "add", 40),
    ]},
    { hash: "a3", author: "Linus", date: T0 + 12 * DAY, message: "first components", changes: [
      ch("components/Hero.tsx", "add", 80), ch("components/Bar.tsx", "add", 50), ch("app/page.tsx", "modify", 30),
    ]},
    { hash: "a4", author: "Linus", date: T0 + 20 * DAY, message: "add tests for engine", changes: [
      ch("tests/engine.test.ts", "add", 90), ch("engine/renderer.ts", "modify", 60),
    ]},
    { hash: "a5", author: "Ada", date: T0 + 30 * DAY, message: "rename and refactor", changes: [
      ch("components/Bar.tsx", "rename", 0, "components/TimelineBar.tsx"),
      ch("components/TimelineBar.tsx", "modify", 40), ch("lib/old.ts", "delete", -15),
    ]},
    { hash: "a6", author: "Grace", date: T0 + 40 * DAY, message: "docs and polish", changes: [
      ch("README.md", "add", 50), ch("app/page.tsx", "modify", 20), ch("engine/renderer.ts", "modify", 35),
    ]},
  ];
  return { repo: { name: "synth", source: "demo" }, commits };
}

// ---------------------------------------------------------------------------
// fileRoles
// ---------------------------------------------------------------------------
describe("roleOf", () => {
  it("identifies the dependency manifest", () =>
    expect(roleOf("package.json")).toMatchObject({ category: "config", role: "Dependency manifest" }));
  it("identifies a page route", () =>
    expect(roleOf("app/page.tsx").role).toContain("Page route"));
  it("identifies the layout", () =>
    expect(roleOf("app/layout.tsx")).toMatchObject({ category: "ui", role: "Layout" }));
  it("identifies engine files", () =>
    expect(roleOf("engine/renderer.ts")).toMatchObject({ category: "engine" }));
  it("identifies type definitions", () =>
    expect(roleOf("lib/types.ts")).toMatchObject({ category: "logic", role: "Type definitions" }));
  it("identifies a UI component with its name", () =>
    expect(roleOf("components/ExportModal.tsx").role).toContain("ExportModal"));
  it("identifies a React hook by use- prefix in lib", () =>
    expect(roleOf("lib/useGalaxy.ts").role).toContain("hook"));
  it("identifies a worker", () =>
    expect(roleOf("lib/layout/worker.ts").category).toBe("logic"));
  it("classifies tests regardless of directory", () => {
    expect(isTestPath("tests/foo.test.ts")).toBe(true);
    expect(isTestPath("app/x.spec.tsx")).toBe(true);
    expect(roleOf("tests/engine.test.ts").category).toBe("test");
    expect(roleOf("app/x.test.tsx").category).toBe("test");
  });
  it("falls back by extension", () => {
    expect(roleOf("weird/thing.py").category).toBe("logic");
    expect(roleOf("a/b/pic.png").category).toBe("asset");
    expect(roleOf("notes.md").category).toBe("docs");
  });
  it("never throws on odd paths", () => {
    expect(() => roleOf("")).not.toThrow();
    expect(() => roleOf("no-extension")).not.toThrow();
    expect(() => roleOf(".gitignore")).not.toThrow();
  });
});

describe("isGeneratedPath", () => {
  it("flags lockfiles and generated artifacts", () => {
    expect(isGeneratedPath("package-lock.json")).toBe(true);
    expect(isGeneratedPath("yarn.lock")).toBe(true);
    expect(isGeneratedPath("pnpm-lock.yaml")).toBe(true);
    expect(isGeneratedPath("Cargo.lock")).toBe(true);
    expect(isGeneratedPath("go.sum")).toBe(true);
    expect(isGeneratedPath("dist/app.min.js")).toBe(true);
    expect(isGeneratedPath("a/b/bundle.js.map")).toBe(true);
    expect(isGeneratedPath("__snapshots__/x.snap")).toBe(true);
  });
  it("does not flag normal source files", () => {
    expect(isGeneratedPath("lib/types.ts")).toBe(false);
    expect(isGeneratedPath("app/page.tsx")).toBe(false);
    expect(isGeneratedPath("package.json")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// techStack
// ---------------------------------------------------------------------------
describe("detectTechStack", () => {
  it("detects Next.js, TypeScript, React from markers and langs", () => {
    const paths = ["next.config.ts", "tsconfig.json", "app/page.tsx", "package.json"];
    const stack = detectTechStack(paths, [{ lang: "ts", count: 10 }, { lang: "config", count: 3 }]);
    const names = stack.map((t) => t.name);
    expect(names).toContain("Next.js");
    expect(names).toContain("TypeScript");
    expect(names).toContain("React");
  });
  it("orders languages before frameworks before tooling", () => {
    const stack = detectTechStack(["next.config.ts", "eslint.config.mjs", "app/x.tsx"], [
      { lang: "ts", count: 5 },
    ]);
    const kinds = stack.map((t) => t.kind);
    const firstFramework = kinds.indexOf("framework");
    const firstTooling = kinds.indexOf("tooling");
    expect(kinds[0]).toBe("language");
    if (firstFramework >= 0 && firstTooling >= 0) expect(firstFramework).toBeLessThan(firstTooling);
  });
  it("detects Rust via Cargo.toml", () => {
    const stack = detectTechStack(["Cargo.toml", "src/main.rs"], [{ lang: "rs", count: 4 }]);
    expect(stack.map((t) => t.name)).toContain("Rust");
  });
});

// ---------------------------------------------------------------------------
// aggregate
// ---------------------------------------------------------------------------
describe("aggregate", () => {
  it("counts churn, commits and authors per file", () => {
    const { files } = aggregate(makeRepo().commits);
    const page = files.get("app/page.tsx")!;
    expect(page.commits).toBe(3); // a1 add, a3 modify, a6 modify
    expect(page.churn).toBe(110); // 60 + 30 + 20
    expect(page.authors.has("Ada")).toBe(true);
    expect(page.authors.has("Linus")).toBe(true);
  });
  it("tracks alive state through delete and rename", () => {
    const { files, filesAlive } = aggregate(makeRepo().commits);
    expect(files.get("lib/old.ts")!.alive).toBe(false); // deleted
    expect(files.get("components/Bar.tsx")!.alive).toBe(false); // renamed away
    expect(files.get("components/TimelineBar.tsx")!.alive).toBe(true); // rename target
    expect(filesAlive).toBeGreaterThan(0);
  });
  it("topDir splits the first segment", () => {
    expect(topDir("app/page.tsx")).toBe("app");
    expect(topDir("README.md")).toBe("(root)");
  });
});

// ---------------------------------------------------------------------------
// keyFiles
// ---------------------------------------------------------------------------
describe("rankKeyFiles", () => {
  it("ranks the high-churn engine renderer at or near the top", () => {
    const { files } = aggregate(makeRepo().commits);
    const ranked = rankKeyFiles(files.values(), 8);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.slice(0, 3).map((k) => k.path)).toContain("engine/renderer.ts");
    expect(ranked[0].reason).toMatch(/commit/);
  });
  it("respects topN", () => {
    const { files } = aggregate(makeRepo().commits);
    expect(rankKeyFiles(files.values(), 3).length).toBe(3);
  });
  it("returns [] for no files", () => expect(rankKeyFiles([], 5)).toEqual([]));
});

// ---------------------------------------------------------------------------
// architecture
// ---------------------------------------------------------------------------
describe("buildModules", () => {
  it("groups by top-level dir and describes purpose", () => {
    const { files } = aggregate(makeRepo().commits);
    const mods = buildModules(files.values());
    const dirs = mods.map((m) => m.dir);
    expect(dirs).toContain("engine");
    expect(dirs).toContain("app");
    expect(dirs).toContain("components");
    const engine = mods.find((m) => m.dir === "engine")!;
    expect(engine.dominantCategory).toBe("engine");
    expect(engine.purpose.toLowerCase()).toContain("engine");
  });
  it("sorts modules by current (live) file count descending", () => {
    const { files } = aggregate(makeRepo().commits);
    const mods = buildModules(files.values());
    for (let i = 1; i < mods.length; i++) expect(mods[i - 1].liveCount).toBeGreaterThanOrEqual(mods[i].liveCount);
  });
  it("lists every current file with its role, excluding dead files", () => {
    const { files } = aggregate(makeRepo().commits);
    const mods = buildModules(files.values());
    const components = mods.find((m) => m.dir === "components")!;
    const names = components.files.map((f) => f.name);
    expect(names).toContain("TimelineBar.tsx"); // rename target, alive
    expect(names).not.toContain("Bar.tsx"); // renamed away, dead
    expect(components.liveCount).toBe(components.files.length);
    for (const f of components.files) {
      expect(f.role.length).toBeGreaterThan(0);
      expect(f.alive).toBe(true);
    }
    // A module whose files were all deleted does not appear.
    expect(mods.every((m) => m.liveCount > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// eras
// ---------------------------------------------------------------------------
describe("detectEras", () => {
  it("produces contiguous eras covering the full window", () => {
    const commits = makeRepo().commits;
    const eras = detectEras(commits, 5);
    expect(eras.length).toBeGreaterThan(0);
    expect(eras[0].t0).toBe(Math.min(...commits.map((c) => c.date)));
    expect(eras[eras.length - 1].t1).toBe(Math.max(...commits.map((c) => c.date)));
    for (let i = 1; i < eras.length; i++) expect(eras[i].t0).toBe(eras[i - 1].t1);
    expect(eras.reduce((s, e) => s + e.commitCount, 0)).toBe(commits.length);
  });
  it("labels the first era Foundation", () => {
    expect(detectEras(makeRepo().commits, 5)[0].label).toBe("Foundation");
  });
  it("handles a single commit", () => {
    const eras = detectEras([{ hash: "x", author: "a", date: T0, message: "m", changes: [] }], 5);
    expect(eras.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// narration
// ---------------------------------------------------------------------------
describe("buildNarration / activeBeat", () => {
  it("starts with an intro and ends with an outro, sorted by time", () => {
    const commits = makeRepo().commits;
    const eras = detectEras(commits, 5);
    const beats = buildNarration("synth — a Next.js project.", eras, commits, T0, T0 + 40 * DAY);
    expect(beats[0].kind).toBe("intro");
    expect(beats[beats.length - 1].kind).toBe("outro");
    for (let i = 1; i < beats.length; i++) expect(beats[i].t).toBeGreaterThanOrEqual(beats[i - 1].t);
  });
  it("activeBeat returns the latest beat at or before t", () => {
    const beats = [
      { t: 0, kind: "intro" as const, text: "a" },
      { t: 100, kind: "era" as const, text: "b" },
      { t: 200, kind: "outro" as const, text: "c" },
    ];
    expect(activeBeat(beats, -1)).toBeNull();
    expect(activeBeat(beats, 0)!.text).toBe("a");
    expect(activeBeat(beats, 150)!.text).toBe("b");
    expect(activeBeat(beats, 9999)!.text).toBe("c");
    expect(activeBeat([], 5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// onboarding (reading path)
// ---------------------------------------------------------------------------
describe("buildReadingPath", () => {
  it("orders README, manifest, entry point and types first, each with a reason", () => {
    const { files } = aggregate(makeRepo().commits);
    const mods = buildMods(files.values());
    const keys = rankKF(files.values(), 8);
    const path = buildReadingPath(keys, mods);
    expect(path.length).toBeGreaterThan(0);
    const paths = path.map((s) => s.path);
    expect(paths).toContain("README.md");
    expect(paths).toContain("package.json");
    expect(paths.some((p) => p.endsWith("page.tsx"))).toBe(true);
    expect(paths).toContain("lib/types.ts");
    // README precedes types.
    expect(paths.indexOf("README.md")).toBeLessThan(paths.indexOf("lib/types.ts"));
    for (const s of path) expect(s.why.length).toBeGreaterThan(0);
    // No duplicates; orders are 1..n.
    expect(new Set(paths).size).toBe(paths.length);
    path.forEach((s, i) => expect(s.order).toBe(i + 1));
  });
});

// ---------------------------------------------------------------------------
// risk
// ---------------------------------------------------------------------------
describe("analyzeRisk", () => {
  it("computes bus factor, key person and ownership", () => {
    const r = analyzeRisk(aggregate(makeRepo().commits));
    expect(r.busFactor).toBeGreaterThanOrEqual(1);
    expect(r.keyPerson).not.toBeNull();
    expect(r.keyPerson!.sharePct).toBeGreaterThan(0);
    expect(r.keyPerson!.sharePct).toBeLessThanOrEqual(100);
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.hotspots.length).toBeGreaterThan(0);
    // engine/renderer.ts is high churn — should surface as a hotspot.
    expect(r.hotspots.map((h) => h.path)).toContain("engine/renderer.ts");
  });
  it("flags live code untouched in the older half as stale", () => {
    const r = analyzeRisk(aggregate(makeRepo().commits));
    expect(Array.isArray(r.stale)).toBe(true);
    expect(r.stale.map((s) => s.path)).toContain("lib/types.ts");
    for (const s of r.stale) expect(s.note).toMatch(/last changed/);
  });
  it("flags single-author repos as max key-person risk", () => {
    const single: CommitTimeline = {
      repo: { name: "solo", source: "local" },
      commits: [
        { hash: "1", author: "Solo", date: T0, message: "a", changes: [ch("a.ts", "add", 10)] },
        { hash: "2", author: "Solo", date: T0 + DAY, message: "b", changes: [ch("a.ts", "modify", 5)] },
      ],
    };
    const r = analyzeRisk(aggregate(single.commits));
    expect(r.busFactor).toBe(1);
    expect(r.keyPerson!.sharePct).toBe(100);
    expect(r.notes.join(" ")).toMatch(/one person|key-person/i);
  });
});

// ---------------------------------------------------------------------------
// coupling
// ---------------------------------------------------------------------------
describe("detectCoupling", () => {
  it("finds files that repeatedly change together", () => {
    const commits: Commit[] = [
      { hash: "1", author: "a", date: T0, message: "m", changes: [ch("x.ts", "modify", 5), ch("y.ts", "modify", 5)] },
      { hash: "2", author: "a", date: T0 + 1, message: "m", changes: [ch("x.ts", "modify", 5), ch("y.ts", "modify", 5)] },
      { hash: "3", author: "a", date: T0 + 2, message: "m", changes: [ch("z.ts", "modify", 5)] },
    ];
    const pairs = detectCoupling(commits, undefined, 8);
    expect(pairs.length).toBe(1);
    expect(pairs[0]).toMatchObject({ a: "x.ts", b: "y.ts", together: 2 });
    expect(pairs[0].score).toBeCloseTo(1, 5);
  });
  it("respects the alive filter and ignores single-touch pairs", () => {
    const commits: Commit[] = [
      { hash: "1", author: "a", date: T0, message: "m", changes: [ch("x.ts", "modify", 5), ch("dead.ts", "modify", 5)] },
      { hash: "2", author: "a", date: T0 + 1, message: "m", changes: [ch("x.ts", "modify", 5), ch("dead.ts", "modify", 5)] },
    ];
    expect(detectCoupling(commits, new Set(["x.ts"]), 8)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// activity
// ---------------------------------------------------------------------------
describe("classifyCommit", () => {
  it("reads conventional-commit prefixes", () => {
    expect(classifyCommit("feat: add export")).toBe("feat");
    expect(classifyCommit("fix(parser): handle null")).toBe("fix");
    expect(classifyCommit("refactor!: drop API")).toBe("refactor");
    expect(classifyCommit("chore: bump deps")).toBe("chore");
  });
  it("falls back to keyword heuristics", () => {
    expect(classifyCommit("Fixed a crash on load")).toBe("fix");
    expect(classifyCommit("Add dark mode support")).toBe("feat");
    expect(classifyCommit("Rewrite the renderer")).toBe("refactor");
    expect(classifyCommit("update tests for board")).toBe("test");
  });
  it("returns other for unrecognized messages", () => {
    expect(classifyCommit("misc tweaks here")).toBe("other");
  });
});

describe("analyzeActivity", () => {
  it("breaks down work types, highlights and momentum", () => {
    const a = analyzeActivity(makeRepo().commits);
    expect(a.buckets.length).toBe(24);
    expect(a.buckets.reduce((s, n) => s + n, 0)).toBe(makeRepo().commits.length);
    expect(a.types.reduce((s, t) => s + t.count, 0)).toBe(makeRepo().commits.length);
    expect(a.types[0].pct).toBeGreaterThan(0);
    expect(["accelerating", "steady", "slowing", "dormant"]).toContain(a.momentum.trend);
    expect(a.momentum.note.length).toBeGreaterThan(0);
  });
  it("surfaces feature commits as highlights, newest first", () => {
    const commits: Commit[] = [
      { hash: "1", author: "a", date: T0, message: "feat: alpha", changes: [] },
      { hash: "2", author: "a", date: T0 + DAY, message: "chore: noise", changes: [] },
      { hash: "3", author: "a", date: T0 + 2 * DAY, message: "feat: beta", changes: [] },
    ];
    const a = analyzeActivity(commits);
    expect(a.highlights[0].message).toContain("beta"); // newest feat first
    expect(a.highlights.every((h) => h.type === "feat" || h.type === "fix")).toBe(true);
  });
  it("handles empty history", () => {
    const a = analyzeActivity([]);
    expect(a.momentum.trend).toBe("dormant");
    expect(a.buckets.every((n) => n === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// treemap
// ---------------------------------------------------------------------------
describe("squarify", () => {
  it("places every positive item within the bounds without overflow", () => {
    const items = [{ value: 6 }, { value: 6 }, { value: 4 }, { value: 3 }, { value: 2 }, { value: 1 }];
    const rects = squarify(items, 0, 0, 100, 80);
    expect(rects.length).toBe(items.length);
    for (const r of rects) {
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
      expect(r.x).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(100 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(80 + 1e-6);
    }
    // Total area ≈ canvas area.
    const area = rects.reduce((s, r) => s + r.w * r.h, 0);
    expect(area).toBeCloseTo(100 * 80, 2);
  });
  it("areas are proportional to values", () => {
    const rects = squarify([{ value: 3 }, { value: 1 }], 0, 0, 40, 40);
    const big = rects[0].w * rects[0].h;
    const small = rects[1].w * rects[1].h;
    expect(big / small).toBeCloseTo(3, 1);
  });
  it("returns [] for empty or zero-area inputs", () => {
    expect(squarify([], 0, 0, 10, 10)).toEqual([]);
    expect(squarify([{ value: 5 }], 0, 0, 0, 10)).toEqual([]);
  });
});

describe("buildTreemap", () => {
  it("lays out modules and their files inside the canvas", () => {
    const { files } = aggregate(makeRepo().commits);
    const mods = buildMods(files.values());
    const groups = buildTreemap(mods, 400, 300);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.x + g.w).toBeLessThanOrEqual(400 + 1e-6);
      expect(g.y + g.h).toBeLessThanOrEqual(300 + 1e-6);
      for (const leaf of g.leaves) {
        expect(leaf.x).toBeGreaterThanOrEqual(g.x - 1e-6);
        expect(leaf.x + leaf.w).toBeLessThanOrEqual(g.x + g.w + 1e-6);
        expect(leaf.y + leaf.h).toBeLessThanOrEqual(g.y + g.h + 1e-6);
        expect(leaf.path.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------
describe("scoreHealth", () => {
  it("rewards tests, docs, collaboration, momentum and structure", () => {
    const strong = scoreHealth({
      contributors: 5,
      busFactor: 3,
      testFileCount: 20,
      liveFiles: 80,
      hasReadme: true,
      hasDocs: true,
      momentum: "accelerating",
      moduleCount: 7,
    });
    const weak = scoreHealth({
      contributors: 1,
      busFactor: 1,
      testFileCount: 0,
      liveFiles: 80,
      hasReadme: false,
      hasDocs: false,
      momentum: "dormant",
      moduleCount: 1,
    });
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.score).toBeLessThanOrEqual(100);
    expect(weak.score).toBeGreaterThanOrEqual(0);
    expect("ABCDF").toContain(strong.grade);
    expect(strong.factors.length).toBe(5);
    expect(strong.factors.reduce((s, f) => s + f.score, 0)).toBe(strong.score);
    // Each factor never exceeds its cap.
    for (const f of strong.factors) expect(f.score).toBeLessThanOrEqual(f.max);
  });
  it("flags a single-contributor repo's collaboration", () => {
    const r = scoreHealth({
      contributors: 1,
      busFactor: 1,
      testFileCount: 5,
      liveFiles: 50,
      hasReadme: true,
      hasDocs: false,
      momentum: "steady",
      moduleCount: 5,
    });
    const collab = r.factors.find((f) => f.name === "Collaboration")!;
    expect(collab.note).toMatch(/key-person|single/i);
  });
});

// ---------------------------------------------------------------------------
// project type
// ---------------------------------------------------------------------------
describe("detectProjectType", () => {
  it("classifies a Next.js app as a web application", () => {
    const { files } = aggregate(makeRepo().commits);
    const mods = buildMods(files.values());
    const stack = detectTechStack([...files.keys()], aggregate(makeRepo().commits).langCounts);
    const pt = detectProjectType([...files.keys()], stack, mods);
    expect(pt.type).toBe("Web application");
    expect(pt.signals.length).toBeGreaterThan(0);
  });
  it("classifies a library (lib/, no app) as a package", () => {
    const paths = ["package.json", "lib/index.ts", "lib/util.ts", "src/core.ts"];
    const stack = detectTechStack(paths, [{ lang: "ts", count: 3 }]);
    const mods = [
      { dir: "lib", liveCount: 2, dominantCategory: "logic" as const, fileCount: 2, purpose: "", keyFiles: [], files: [] },
      { dir: "src", liveCount: 1, dominantCategory: "logic" as const, fileCount: 1, purpose: "", keyFiles: [], files: [] },
    ];
    const pt = detectProjectType(paths, stack, mods);
    expect(pt.type).toBe("Library / package");
  });
  it("always returns a type with a tagline", () => {
    const pt = detectProjectType([], [], []);
    expect(pt.type.length).toBeGreaterThan(0);
    expect(pt.tagline.length).toBeGreaterThan(0);
    expect(["high", "medium", "low"]).toContain(pt.confidence);
  });
});

// ---------------------------------------------------------------------------
// tree + sunburst
// ---------------------------------------------------------------------------
describe("buildFileTree", () => {
  it("nests by path and sums folder values", () => {
    const root = buildFileTree([
      { path: "app/page.tsx", category: "ui", value: 10 },
      { path: "app/layout.tsx", category: "ui", value: 5 },
      { path: "lib/types.ts", category: "logic", value: 8 },
    ]);
    const app = root.children.find((c) => c.name === "app")!;
    expect(app.isFile).toBe(false);
    expect(app.value).toBe(15); // 10 + 5
    expect(app.children.length).toBe(2);
    expect(app.children.every((c) => c.isFile)).toBe(true);
    const lib = root.children.find((c) => c.name === "lib")!;
    expect(lib.value).toBe(8);
  });
  it("orders folders before files", () => {
    const root = buildFileTree([
      { path: "readme.md", category: "docs", value: 1 },
      { path: "src/a.ts", category: "logic", value: 5 },
    ]);
    expect(root.children[0].isFile).toBe(false); // src folder first
    expect(root.children[0].name).toBe("src");
  });
});

describe("buildSunburst", () => {
  it("partitions the full circle by value, deeper nodes within their parent", () => {
    const root = buildFileTree([
      { path: "a/x.ts", category: "logic", value: 30 },
      { path: "a/y.ts", category: "logic", value: 10 },
      { path: "b/z.ts", category: "ui", value: 20 },
    ]);
    const arcs = buildSunburst(root, 4);
    expect(arcs.length).toBeGreaterThan(0);
    // Depth-1 arcs (folders a, b) tile the whole circle.
    const d1 = arcs.filter((x) => x.depth === 1).sort((p, q) => p.startAngle - q.startAngle);
    expect(d1[0].startAngle).toBeCloseTo(0, 5);
    expect(d1[d1.length - 1].endAngle).toBeCloseTo(Math.PI * 2, 5);
    for (const a of arcs) {
      expect(a.endAngle).toBeGreaterThanOrEqual(a.startAngle);
      expect(a.depth).toBeGreaterThanOrEqual(1);
    }
    // Children of "a" stay within a's angular span.
    const a = d1.find((x) => x.name === "a")!;
    const childrenOfA = arcs.filter((x) => x.depth === 2 && x.path.startsWith("a/"));
    for (const c of childrenOfA) {
      expect(c.startAngle).toBeGreaterThanOrEqual(a.startAngle - 1e-6);
      expect(c.endAngle).toBeLessThanOrEqual(a.endAngle + 1e-6);
    }
  });
});

// ---------------------------------------------------------------------------
// team topology
// ---------------------------------------------------------------------------
describe("analyzeTeam", () => {
  it("fingerprints work style from commit size and breadth", () => {
    const commits: Commit[] = [
      // Surgical specialist: many small commits in one folder.
      { hash: "1", author: "Sam", date: T0, message: "m", changes: [ch("lib/a.ts", "modify", 5)] },
      { hash: "2", author: "Sam", date: T0 + DAY, message: "m", changes: [ch("lib/b.ts", "modify", 5)] },
      { hash: "3", author: "Sam", date: T0 + 2 * DAY, message: "m", changes: [ch("lib/a.ts", "modify", 5)] },
      // Sweeping generalist: big commits across many folders.
      {
        hash: "4",
        author: "Gail",
        date: T0 + 3 * DAY,
        message: "m",
        changes: [
          ch("app/x.tsx", "add", 5), ch("lib/y.ts", "add", 5), ch("engine/z.ts", "add", 5),
          ch("docs/d.md", "add", 5), ch("tests/t.test.ts", "add", 5), ch("public/p.json", "add", 5),
          ch("styles/s.css", "add", 5), ch("scripts/b.mjs", "add", 5), ch("api/h.ts", "add", 5),
          ch("hooks/u.ts", "add", 5), ch("config.json", "add", 5),
        ],
      },
    ];
    const t = analyzeTeam(commits);
    const sam = t.fingerprints.find((f) => f.author === "Sam")!;
    const gail = t.fingerprints.find((f) => f.author === "Gail")!;
    expect(sam.styleTags).toEqual(["surgical", "specialist"]);
    expect(gail.styleTags[0]).toBe("sweeping");
    expect(gail.styleTags[1]).toBe("generalist");
    expect(sam.style).toContain("Surgical");
  });

  it("detects two silos when groups never share files", () => {
    const commits: Commit[] = [
      { hash: "1", author: "A", date: T0, message: "m", changes: [ch("mod1/a.ts", "modify", 5), ch("mod1/b.ts", "modify", 5)] },
      { hash: "2", author: "B", date: T0 + 1, message: "m", changes: [ch("mod1/a.ts", "modify", 5), ch("mod1/b.ts", "modify", 5)] },
      { hash: "3", author: "C", date: T0 + 2, message: "m", changes: [ch("mod2/x.ts", "modify", 5), ch("mod2/y.ts", "modify", 5)] },
      { hash: "4", author: "D", date: T0 + 3, message: "m", changes: [ch("mod2/x.ts", "modify", 5), ch("mod2/y.ts", "modify", 5)] },
    ];
    const t = analyzeTeam(commits);
    expect(t.silos.length).toBe(2);
    expect(t.brokers).toEqual([]);
    expect(t.note).toMatch(/silos/i);
  });

  it("identifies a broker bridging two otherwise-separate groups", () => {
    const commits: Commit[] = [
      { hash: "1", author: "A", date: T0, message: "m", changes: [ch("mod1/a.ts", "modify", 5), ch("mod1/b.ts", "modify", 5)] },
      { hash: "2", author: "B", date: T0 + 1, message: "m", changes: [ch("mod1/a.ts", "modify", 5), ch("mod1/b.ts", "modify", 5)] },
      { hash: "3", author: "C", date: T0 + 2, message: "m", changes: [ch("mod2/x.ts", "modify", 5), ch("mod2/y.ts", "modify", 5)] },
      { hash: "4", author: "D", date: T0 + 3, message: "m", changes: [ch("mod2/x.ts", "modify", 5), ch("mod2/y.ts", "modify", 5)] },
      // E touches both groups' files → the bridge.
      { hash: "5", author: "E", date: T0 + 4, message: "m", changes: [ch("mod1/a.ts", "modify", 5), ch("mod1/b.ts", "modify", 5)] },
      { hash: "6", author: "E", date: T0 + 5, message: "m", changes: [ch("mod2/x.ts", "modify", 5), ch("mod2/y.ts", "modify", 5)] },
    ];
    const t = analyzeTeam(commits);
    expect(t.brokers).toContain("E");
    expect(t.note).toMatch(/broker/i);
  });

  it("handles a single contributor gracefully", () => {
    const t = analyzeTeam([{ hash: "1", author: "Solo", date: T0, message: "m", changes: [ch("a.ts", "add", 5)] }]);
    expect(t.fingerprints.length).toBe(1);
    expect(t.silos).toEqual([]);
    expect(t.brokers).toEqual([]);
    expect(t.note).toMatch(/single contributor/i);
    expect(t.concentration.gini).toBe(1);
  });

  it("computes higher concentration when one author dominates", () => {
    const skewed: Commit[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ hash: `a${i}`, author: "Boss", date: T0 + i * DAY, message: "m", changes: [ch("a.ts", "modify", 5)] })),
      { hash: "b", author: "Helper", date: T0 + 20 * DAY, message: "m", changes: [ch("b.ts", "modify", 5)] },
    ];
    const even: Commit[] = [
      { hash: "1", author: "X", date: T0, message: "m", changes: [ch("a.ts", "modify", 5)] },
      { hash: "2", author: "Y", date: T0 + DAY, message: "m", changes: [ch("b.ts", "modify", 5)] },
      { hash: "3", author: "Z", date: T0 + 2 * DAY, message: "m", changes: [ch("c.ts", "modify", 5)] },
    ];
    expect(analyzeTeam(skewed).concentration.gini).toBeGreaterThan(analyzeTeam(even).concentration.gini);
    expect(analyzeTeam(skewed).concentration.topShare).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// commit culture
// ---------------------------------------------------------------------------
describe("analyzeCulture", () => {
  const eras = detectEras(makeRepo().commits, 5);
  it("scores conventional, well-described commits higher than low-effort ones", () => {
    const good: Commit[] = [
      { hash: "1", author: "a", date: T0, message: "feat: add a proper streaming export pipeline with backpressure", changes: [] },
      { hash: "2", author: "a", date: T0 + DAY, message: "fix(parser): handle null tokens and add regression tests", changes: [] },
      { hash: "3", author: "a", date: T0 + 2 * DAY, message: "refactor: extract the layout worker into its own module", changes: [] },
    ];
    const bad: Commit[] = [
      { hash: "1", author: "a", date: T0, message: "wip", changes: [] },
      { hash: "2", author: "a", date: T0 + DAY, message: "fix", changes: [] },
      { hash: "3", author: "a", date: T0 + 2 * DAY, message: ".", changes: [] },
    ];
    const g = analyzeCulture(good, detectEras(good, 5));
    const b = analyzeCulture(bad, detectEras(bad, 5));
    expect(g.score).toBeGreaterThan(b.score);
    expect("ABCDF").toContain(g.grade);
    expect(g.metrics.length).toBe(4);
  });
  it("produces a per-era trend point for each era", () => {
    const c = analyzeCulture(makeRepo().commits, eras);
    expect(c.trend.length).toBe(eras.length);
    for (const p of c.trend) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// notable events
// ---------------------------------------------------------------------------
describe("detectEvents", () => {
  it("detects cleanups, feature drops, and contributor arrivals", () => {
    const commits: Commit[] = [
      { hash: "1", author: "Founder", date: T0, message: "init", changes: [ch("a.ts", "add", 10)] },
      // Large feature drop (>=8 adds).
      {
        hash: "2", author: "Founder", date: T0 + DAY, message: "feat: build the engine",
        changes: Array.from({ length: 9 }, (_, i) => ch(`engine/f${i}.ts`, "add", 20)),
      },
      // A newcomer with >=3 commits.
      { hash: "3", author: "Newbie", date: T0 + 2 * DAY, message: "c1", changes: [ch("x.ts", "add", 5)] },
      { hash: "4", author: "Newbie", date: T0 + 3 * DAY, message: "c2", changes: [ch("x.ts", "modify", 5)] },
      { hash: "5", author: "Newbie", date: T0 + 4 * DAY, message: "c3", changes: [ch("x.ts", "modify", 5)] },
      // Mass cleanup (>=5 deletes, majority deletions).
      {
        hash: "6", author: "Founder", date: T0 + 5 * DAY, message: "chore: drop legacy",
        changes: Array.from({ length: 6 }, (_, i) => ch(`engine/f${i}.ts`, "delete", -20)),
      },
    ];
    const events = detectEvents(commits, 8);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("feature");
    expect(kinds).toContain("cleanup");
    expect(kinds).toContain("newcomer");
    // Chronological order.
    for (let i = 1; i < events.length; i++) expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t);
  });
  it("returns [] for empty history and respects topN", () => {
    expect(detectEvents([], 8)).toEqual([]);
    const many: Commit[] = Array.from({ length: 30 }, (_, i) => ({
      hash: `${i}`, author: "a", date: T0 + i * DAY, message: "m",
      changes: Array.from({ length: 9 }, (_, j) => ch(`d/f${i}_${j}.ts`, "add", 10)),
    }));
    expect(detectEvents(many, 5).length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// extended metrics
// ---------------------------------------------------------------------------
describe("computeMetrics", () => {
  it("computes commit-size buckets, heatmaps and largest dirs", () => {
    const commits = makeRepo().commits;
    const agg = aggregate(commits);
    const eras = detectEras(commits, 5);
    const m = computeMetrics(commits, agg, eras);
    expect(m.commitSizes.reduce((s, b) => s + b.count, 0)).toBe(commits.length);
    expect(m.weekday.length).toBe(7);
    expect(m.hour.length).toBe(24);
    expect(m.weekday.reduce((s, n) => s + n, 0)).toBe(commits.length);
    expect(m.hour.reduce((s, n) => s + n, 0)).toBe(commits.length);
    expect(m.largestDirs.length).toBeGreaterThan(0);
    expect(m.largestDirs[0].churn).toBeGreaterThanOrEqual(m.largestDirs[m.largestDirs.length - 1].churn);
    expect(Array.isArray(m.recentlyActive)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// release detection
// ---------------------------------------------------------------------------
describe("detectReleases", () => {
  it("detects semver and release-worded commits", () => {
    const commits: Commit[] = [
      { hash: "1", author: "a", date: T0, message: "feat: thing", changes: [] },
      { hash: "2", author: "a", date: T0 + DAY, message: "chore: release v1.2.0", changes: [ch("package.json", "modify", 2)] },
      { hash: "3", author: "a", date: T0 + 2 * DAY, message: "bump version to 1.3.0", changes: [ch("package.json", "modify", 2)] },
      { hash: "4", author: "a", date: T0 + 3 * DAY, message: "normal work", changes: [ch("a.ts", "modify", 5)] },
    ];
    const rels = detectReleases(commits, 20);
    expect(rels.length).toBe(2);
    expect(rels[0].version).toBe("1.2.0");
    expect(rels[1].version).toBe("1.3.0");
    for (let i = 1; i < rels.length; i++) expect(rels[i].t).toBeGreaterThanOrEqual(rels[i - 1].t);
  });
  it("returns [] when there are no releases", () => {
    expect(detectReleases([{ hash: "1", author: "a", date: T0, message: "wip", changes: [] }], 20)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// approachable first files
// ---------------------------------------------------------------------------
describe("suggestFirstFiles", () => {
  it("suggests code files, excluding hotspots and generated files", () => {
    const agg = aggregate(makeRepo().commits);
    const mods = buildMods(agg.files.values());
    const risk = analyzeRisk(agg);
    const suggestions = suggestFirstFiles(agg, mods, risk.hotspots, [], 5);
    for (const s of suggestions) {
      expect(risk.hotspots.some((h) => h.path === s.path)).toBe(false);
      expect(s.path.endsWith(".lock")).toBe(false);
      expect(s.why.length).toBeGreaterThan(0);
    }
    expect(suggestions.length).toBeLessThanOrEqual(5);
  });
  it("returns [] when there are no code candidates", () => {
    const onlyDocs: CommitTimeline = {
      repo: { name: "d", source: "local" },
      commits: [{ hash: "1", author: "a", date: T0, message: "m", changes: [ch("README.md", "add", 10)] }],
    };
    const agg = aggregate(onlyDocs.commits);
    expect(suggestFirstFiles(agg, buildMods(agg.files.values()), [], [], 5)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// dependency graph (imports)
// ---------------------------------------------------------------------------
describe("parseImports", () => {
  it("extracts es imports, exports, require and dynamic import", () => {
    const src = `
      import a from "./a";
      import { b } from '../b';
      import * as c from "@/lib/c";
      import "./side-effect";
      export { d } from "./d";
      const e = require("./e");
      const f = await import("./f");
      import x from "react"; // external
    `;
    const specs = parseImports(src);
    expect(specs).toContain("./a");
    expect(specs).toContain("../b");
    expect(specs).toContain("@/lib/c");
    expect(specs).toContain("./side-effect");
    expect(specs).toContain("./d");
    expect(specs).toContain("./e");
    expect(specs).toContain("./f");
    expect(specs).toContain("react");
  });
});

describe("normalizePath / resolveImport", () => {
  const files = new Set(["lib/a.ts", "lib/sub/b.tsx", "lib/c/index.ts", "app/page.tsx"]);
  it("normalizes . and .. segments", () => {
    expect(normalizePath("lib/sub/../a.ts")).toBe("lib/a.ts");
    expect(normalizePath("./lib/./a.ts")).toBe("lib/a.ts");
  });
  it("resolves relative imports with extension guessing", () => {
    expect(resolveImport("lib/sub/b.tsx", "../a", files)).toBe("lib/a.ts");
    expect(resolveImport("app/page.tsx", "../lib/c", files)).toBe("lib/c/index.ts");
  });
  it("resolves alias imports", () => {
    expect(resolveImport("app/page.tsx", "@/lib/a", files, { prefix: "@/", base: "" })).toBe("lib/a.ts");
  });
  it("returns null for bare/external and unresolved specifiers", () => {
    expect(resolveImport("app/page.tsx", "react", files)).toBeNull();
    expect(resolveImport("app/page.tsx", "./missing", files)).toBeNull();
  });
});

describe("buildDepGraph", () => {
  it("builds edges and ranks core vs entangled files", () => {
    const contents = new Map<string, string>([
      ["lib/types.ts", "export interface T {}"],
      ["lib/a.ts", "import { T } from './types';"],
      ["lib/b.ts", "import { T } from './types'; import './a';"],
      ["app/page.tsx", "import './../lib/b'; import { T } from '@/lib/types';"],
      ["lib/orphan.ts", "export const x = 1;"],
    ]);
    const g = buildDepGraph(contents, { prefix: "@/", base: "" });
    expect(g.available).toBe(true);
    expect(g.edgeCount).toBeGreaterThan(0);
    // types.ts is imported by a, b, page → most depended on.
    expect(g.mostDependedOn[0].path).toBe("lib/types.ts");
    expect(g.mostDependedOn[0].count).toBeGreaterThanOrEqual(3);
    expect(g.orphans).toContain("lib/orphan.ts");
  });
  it("detects an import cycle", () => {
    const contents = new Map<string, string>([
      ["a.ts", "import './b';"],
      ["b.ts", "import './a';"],
    ]);
    const g = buildDepGraph(contents);
    expect(g.cycles.length).toBeGreaterThan(0);
  });
  it("reports unavailable when there are no source files", () => {
    expect(buildDepGraph(new Map([["readme.md", "# hi"]])).available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// grounded AI copilot prompt
// ---------------------------------------------------------------------------
describe("buildGroundedPrompt / briefContext", () => {
  const brief = buildBrief(makeRepo());
  it("serializes the brief into factual context", () => {
    const ctx = briefContext(brief);
    expect(ctx).toContain("PROJECT: synth");
    expect(ctx).toContain("MODULES:");
    expect(ctx).toContain("KEY FILES:");
    expect(ctx).toContain("engine/renderer.ts");
    expect(ctx).not.toContain("`"); // backticks stripped for the model
  });
  it("builds a grounding system prompt and a user prompt with the question", () => {
    const p = buildGroundedPrompt(brief, "where do I start?");
    expect(p.system.toLowerCase()).toContain("only from the facts");
    expect(p.user).toContain("FACTS about synth");
    expect(p.user).toContain("QUESTION: where do I start?");
  });
  it("extracts text deltas from Anthropic SSE chunks and ignores noise", () => {
    const sse = [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
      'data: {"type":"message_stop"}',
      'data: [DONE]',
    ].join("\n");
    expect(extractTextDeltas(sse)).toEqual(["Hello", " world"]);
    expect(extractTextDeltas("data: {not json")).toEqual([]);
  });
  it("routes provider by key shape and parses Gemini SSE", () => {
    expect(pickProvider("sk-ant-abc")).toBe("anthropic");
    expect(pickProvider("AIzaSyABC123")).toBe("gemini");
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":" there"}]}}]}',
    ].join("\n");
    expect(extractGeminiTextDeltas(sse)).toEqual(["Hi", " there"]);
    expect(extractGeminiTextDeltas("data: nope")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// glossary
// ---------------------------------------------------------------------------
describe("buildGlossary", () => {
  it("surfaces recurring domain terms and drops boilerplate/extensions", () => {
    const g = buildGlossary([
      "engine/supernova.ts",
      "engine/supernova-trail.ts",
      "lib/timeline/scene.ts",
      "lib/timeline/build.ts",
      "components/SupernovaOverlay.tsx",
      "src/index.ts",
      "lib/types.ts",
    ]);
    const terms = g.map((t) => t.term);
    expect(terms).toContain("supernova"); // appears in 3 files
    expect(terms).toContain("timeline"); // appears in 2 files
    expect(terms).not.toContain("ts"); // extension filtered
    expect(terms).not.toContain("index"); // boilerplate filtered
    expect(terms).not.toContain("types"); // boilerplate filtered
    for (let i = 1; i < g.length; i++) expect(g[i - 1].count).toBeGreaterThanOrEqual(g[i].count);
  });
  it("returns [] for no recurring terms", () => {
    expect(buildGlossary(["a/unique-one.ts", "b/another.ts"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// conventions
// ---------------------------------------------------------------------------
describe("detectConventions", () => {
  it("detects CI, Docker, monorepo, tests and dominant casing", () => {
    const c = detectConventions([
      ".github/workflows/ci.yml",
      "Dockerfile",
      "packages/core/src/index.ts",
      "packages/core/src/parse-tree.ts",
      "packages/core/src/build-graph.ts",
      "packages/ui/render-view.tsx",
      "tests/core.test.ts",
    ]);
    expect(c.hasCI).toBe(true);
    expect(c.hasDocker).toBe(true);
    expect(c.monorepo).toBe(true);
    expect(c.hasTests).toBe(true);
    expect(c.casing).toBe("kebab-case");
    expect(c.signals.length).toBeGreaterThan(0);
  });
  it("reports mixed casing when there is no clear majority", () => {
    const c = detectConventions(["a/one_two.ts", "a/ThreeFour.ts", "a/five-six.ts"]);
    expect(c.casing).toBe("mixed");
  });
});

// ---------------------------------------------------------------------------
// health over time
// ---------------------------------------------------------------------------
describe("computeHealthTrend", () => {
  it("produces one cumulative point per era, ending at the headline grade", () => {
    const commits = makeRepo().commits;
    const eras = detectEras(commits, 5);
    const trend = computeHealthTrend(commits, eras);
    expect(trend.length).toBe(eras.length);
    trend.forEach((p, i) => expect(p.index).toBe(eras[i].index));
    // The final cumulative point uses all commits, so it equals the full grade.
    const full = healthFromCommits(commits);
    expect(trend[trend.length - 1].score).toBe(full.score);
    for (const p of trend) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(100);
      expect("ABCDF").toContain(p.grade);
    }
  });
  it("matches buildBrief's health and trend", () => {
    const brief = buildBrief(makeRepo());
    expect(brief.healthTrend.length).toBe(brief.eras.length);
    expect(brief.healthTrend[brief.healthTrend.length - 1].score).toBe(brief.health.score);
  });
});

// ---------------------------------------------------------------------------
// what-if simulator
// ---------------------------------------------------------------------------
describe("applyScenario", () => {
  it("drops commits by an excluded author and rebuilds a smaller brief", () => {
    const base = buildBrief(makeRepo());
    const scenario = applyScenario(makeRepo(), { excludeAuthors: ["Ada"] });
    expect(scenario.commits.every((c) => c.author !== "Ada")).toBe(true);
    expect(scenario.commits.length).toBeLessThan(makeRepo().commits.length);
    const after = buildBrief(scenario);
    expect(after.stats.contributors).toBe(base.stats.contributors - 1);
  });
  it("strips changes under an excluded folder and drops emptied commits", () => {
    const scenario = applyScenario(makeRepo(), { excludeDirs: ["engine"] });
    for (const c of scenario.commits) {
      for (const ch of c.changes) {
        expect(ch.path.startsWith("engine/")).toBe(false);
      }
      expect(c.changes.length).toBeGreaterThan(0);
    }
    const after = buildBrief(scenario);
    expect(after.modules.some((m) => m.dir === "engine")).toBe(false);
  });
  it("does not mutate the original timeline", () => {
    const ct = makeRepo();
    const before = ct.commits.length;
    applyScenario(ct, { excludeAuthors: ["Ada"], excludeDirs: ["lib"] });
    expect(ct.commits.length).toBe(before);
  });
  it("an empty scenario returns an equivalent timeline", () => {
    const ct = makeRepo();
    expect(applyScenario(ct, {}).commits.length).toBe(ct.commits.length);
  });
});

// ---------------------------------------------------------------------------
// ask the repo
// ---------------------------------------------------------------------------
describe("answerQuery", () => {
  const brief = buildBrief(makeRepo());

  it("routes common questions to the right intent", () => {
    expect(answerQuery(brief, "where are the tests?").intent).toBe("tests");
    expect(answerQuery(brief, "what's the biggest file?").intent).toBe("keyfiles");
    expect(answerQuery(brief, "who owns the code?").intent).toBe("contributors");
    expect(answerQuery(brief, "where do I start?").intent).toBe("onboarding");
    expect(answerQuery(brief, "how healthy is it?").intent).toBe("health");
    expect(answerQuery(brief, "what's it built with?").intent).toBe("stack");
    expect(answerQuery(brief, "show me the hotspots").intent).toBe("hotspots");
    expect(answerQuery(brief, "how many commits?").intent).toBe("stats");
  });

  it("answers ownership for a named folder", () => {
    const a = answerQuery(brief, "who owns engine?");
    expect(a.intent).toBe("ownership");
    expect(a.text.toLowerCase()).toContain("engine");
  });

  it("returns test files for the tests question", () => {
    const a = answerQuery(brief, "tests");
    expect(a.files && a.files.some((f) => f.path.includes("test"))).toBe(true);
  });

  it("routes the new insight intents", () => {
    expect(answerQuery(brief, "good first files to contribute").intent).toBe("firstFiles");
    expect(answerQuery(brief, "what releases are there?").intent).toBe("releases");
    expect(answerQuery(brief, "what conventions / naming style?").intent).toBe("conventions");
    expect(answerQuery(brief, "show the vocabulary / terms").intent).toBe("glossary");
    expect(answerQuery(brief, "notable moments / rewrites").intent).toBe("events");
    expect(answerQuery(brief, "what's the busiest day?").intent).toBe("when");
  });

  it("falls back to keyword search across files", () => {
    const a = answerQuery(brief, "renderer");
    expect(a.intent).toBe("search");
    expect(a.files!.some((f) => f.path.includes("renderer"))).toBe(true);
  });

  it("gives suggestions for empty or unknown queries", () => {
    expect(answerQuery(brief, "").intent).toBe("empty");
    expect(answerQuery(brief, "zxqw").intent).toBe("unknown");
    expect(answerQuery(brief, "").bullets!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// markdown export
// ---------------------------------------------------------------------------
describe("briefToMarkdown", () => {
  it("renders the brief into a non-trivial ONBOARDING document", () => {
    const md = briefToMarkdown(buildBrief(makeRepo()));
    expect(md).toContain("# synth — Onboarding Guide");
    expect(md).toContain("## Start here");
    expect(md).toContain("## Map of the codebase");
    expect(md).toContain("## Health & ownership");
    expect(md).toContain("Bus factor");
    expect(md.length).toBeGreaterThan(200);
  });
});

// ---------------------------------------------------------------------------
// buildBrief (end to end)
// ---------------------------------------------------------------------------
describe("buildBrief", () => {
  it("assembles a complete brief from a synthetic repo", () => {
    const brief = buildBrief(makeRepo());
    expect(brief.name).toBe("synth");
    expect(brief.projectType.type.length).toBeGreaterThan(0);
    expect(brief.headline).toContain("synth");
    expect(brief.summary.length).toBeGreaterThan(20);
    expect(brief.techStack.map((t) => t.name)).toContain("Next.js");
    expect(brief.modules.length).toBeGreaterThan(0);
    expect(brief.keyFiles.length).toBeGreaterThan(0);
    expect(brief.contributors.length).toBe(3);
    expect(brief.readingPath.length).toBeGreaterThan(0);
    expect(brief.risk.busFactor).toBeGreaterThanOrEqual(1);
    expect(brief.coupling.length).toBeGreaterThanOrEqual(0);
    expect(brief.activity.types.length).toBeGreaterThan(0);
    expect(brief.activity.buckets.length).toBe(24);
    expect(brief.health.score).toBeGreaterThanOrEqual(0);
    expect(brief.health.score).toBeLessThanOrEqual(100);
    expect(brief.health.factors.length).toBe(5);
    expect(brief.team.fingerprints.length).toBe(3);
    expect(brief.eras.length).toBeGreaterThan(0);
    expect(brief.narration.length).toBeGreaterThanOrEqual(2);
    expect(brief.stats.totalCommits).toBe(6);
    expect(brief.stats.contributors).toBe(3);
  });
  it("is deterministic", () => {
    expect(JSON.stringify(buildBrief(makeRepo()))).toBe(JSON.stringify(buildBrief(makeRepo())));
  });
  it("handles an empty repo without throwing", () => {
    const brief = buildBrief({ repo: { name: "empty", source: "local" }, commits: [] });
    expect(brief.keyFiles).toEqual([]);
    expect(brief.stats.totalCommits).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// overlay (pure parts)
// ---------------------------------------------------------------------------
describe("wrapText", () => {
  const measurer = { measureText: (s: string) => ({ width: s.length * 10 }) };
  it("wraps to the given width", () => {
    const lines = wrapText(measurer, "one two three four five", 70);
    expect(lines.length).toBeGreaterThan(1);
    for (const ln of lines) expect(ln.length * 10).toBeLessThanOrEqual(70 + 50);
  });
  it("keeps an over-long word on its own line", () => {
    const lines = wrapText(measurer, "supercalifragilistic ok", 50);
    expect(lines[0]).toBe("supercalifragilistic");
  });
  it("returns [] for empty text", () => expect(wrapText(measurer, "   ", 100)).toEqual([]));
});

describe("titleCardOpacity", () => {
  it("is 0 outside the intro window", () => {
    expect(titleCardOpacity(0.5)).toBe(0);
    expect(titleCardOpacity(0.9)).toBe(0);
  });
  it("peaks during the hold", () => expect(titleCardOpacity(0.1)).toBe(1));
  it("ramps in and out", () => {
    expect(titleCardOpacity(0.02)).toBeGreaterThan(0);
    expect(titleCardOpacity(0.02)).toBeLessThan(1);
    expect(titleCardOpacity(0.2)).toBeGreaterThan(0);
    expect(titleCardOpacity(0.2)).toBeLessThan(1);
  });
});
