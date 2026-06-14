// ---------------------------------------------------------------------------
// insights/healthTrend.ts — health over time. Because the brief is a pure fold
// over commits, we can score health at any point in history by folding only the
// commits up to that point. Scoring at the end of each era gives a trend ("tests
// rising, bus factor falling") instead of a single snapshot. Pure and
// deterministic.
//
// `healthFromCommits` is the single source of truth for turning a commit list
// into a HealthScore; brief.ts uses it for the final grade and this module uses
// it per era, so the last trend point always equals the headline grade.
// ---------------------------------------------------------------------------

import type { Commit } from "@/lib/types";
import type { Era, HealthScore, HealthTrendPoint } from "./types";
import { aggregate } from "./aggregate";
import { buildModules } from "./architecture";
import { analyzeRisk } from "./risk";
import { analyzeActivity } from "./activity";
import { scoreHealth } from "./health";
import { roleOf } from "./fileRoles";

/** Score project health from a commit list alone (the canonical health inputs). */
export function healthFromCommits(commits: Commit[]): HealthScore {
  const agg = aggregate(commits);
  const modules = buildModules(agg.files.values());
  const risk = analyzeRisk(agg);
  const activity = analyzeActivity(commits);
  const aliveFiles = [...agg.files.values()].filter((f) => f.alive);
  const testFileCount = aliveFiles.filter((f) => roleOf(f.path).category === "test").length;
  const hasReadme = aliveFiles.some((f) => /^readme/i.test(f.path.split("/").pop() ?? ""));
  const hasDocs =
    modules.some((m) => m.dir.toLowerCase() === "docs") ||
    aliveFiles.filter((f) => roleOf(f.path).category === "docs").length > 1;
  return scoreHealth({
    contributors: agg.authors.size,
    busFactor: risk.busFactor,
    testFileCount,
    liveFiles: agg.filesAlive,
    hasReadme,
    hasDocs,
    momentum: activity.momentum.trend,
    moduleCount: modules.length,
  });
}

/** Cumulative health at the end of each era. */
export function computeHealthTrend(commits: Commit[], eras: Era[]): HealthTrendPoint[] {
  return eras.map((e) => {
    const slice = commits.filter((c) => c.date <= e.t1);
    const h = healthFromCommits(slice);
    return { index: e.index, label: e.label, t: e.t1, score: h.score, grade: h.grade };
  });
}
