// ---------------------------------------------------------------------------
// insights/keyFiles.ts — rank the files that matter most for understanding the
// project. Importance blends three normalized signals: churn (how much code
// moved through it), commit-touch count (how often it was edited), and a role
// weight (entry points, engine and core config punch above their churn). Files
// still alive at the end are favored over long-dead ones.
// ---------------------------------------------------------------------------

import type { FileCategory, KeyFile } from "./types";
import type { FileAgg } from "./aggregate";
import { roleOf } from "./fileRoles";

// Role weight by category: how much a file's *kind* boosts its importance.
const CATEGORY_WEIGHT: Record<FileCategory, number> = {
  engine: 1.0,
  logic: 0.9,
  ui: 0.8,
  config: 0.55,
  build: 0.5,
  data: 0.4,
  style: 0.4,
  test: 0.35,
  docs: 0.3,
  asset: 0.15,
  other: 0.3,
};

/**
 * Auto-generated / vendored files churn enormously but teach a newcomer
 * nothing. Damp their score so a lockfile never crowds out real source.
 */
function noiseMultiplier(path: string): number {
  const base = (path.split("/").pop() ?? "").toLowerCase();
  if (/(^|[-.])lock\.|lock$|-lock\.json$|\.lock$/.test(base)) return 0.12;
  if (base === "package-lock.json" || base === "yarn.lock" || base === "pnpm-lock.yaml") return 0.12;
  if (/\.(min\.(js|css)|map|snap)$/.test(base)) return 0.2;
  if (/(^|\/)(node_modules|dist|build|out|vendor|\.next)(\/|$)/.test(path)) return 0.15;
  return 1;
}

/** Filenames that are structurally central regardless of churn. */
function entryBoost(path: string): number {
  const base = (path.split("/").pop() ?? "").toLowerCase();
  if (base.startsWith("page.")) return 1.0;
  if (base.startsWith("layout.")) return 0.9;
  if (base === "types.ts" || base === "types.d.ts") return 0.8;
  if (base === "index.ts" || base === "index.tsx" || base === "main.ts" || base === "app.tsx")
    return 0.8;
  if (base === "package.json") return 0.6;
  return 0;
}

function reasonFor(commits: number, churnRank: number, alive: boolean, boost: number): string {
  const parts: string[] = [];
  if (boost >= 0.8) parts.push("central entry point");
  if (churnRank <= 0.15) parts.push("heavily reworked");
  else if (churnRank <= 0.4) parts.push("frequently changed");
  parts.push(`${commits} commit${commits === 1 ? "" : "s"}`);
  if (!alive) parts.push("removed");
  return parts.join(" · ");
}

/**
 * Rank files by importance and return the top `topN` (default 8). Scores are
 * relative within this repo. `reason` explains the ranking in a phrase.
 */
export function rankKeyFiles(files: Iterable<FileAgg>, topN = 8): KeyFile[] {
  const arr = [...files];
  if (arr.length === 0) return [];

  const maxChurn = Math.max(1, ...arr.map((f) => f.churn));
  const maxCommits = Math.max(1, ...arr.map((f) => f.commits));

  // Pre-sort by churn to compute a churn percentile rank for the reason text.
  const byChurn = [...arr].sort((a, b) => b.churn - a.churn);
  const churnRank = new Map<string, number>();
  byChurn.forEach((f, i) => churnRank.set(f.path, i / Math.max(1, byChurn.length - 1)));

  const scored = arr.map((f) => {
    const role = roleOf(f.path);
    const churnN = f.churn / maxChurn;
    const commitN = f.commits / maxCommits;
    const weight = CATEGORY_WEIGHT[role.category];
    const boost = entryBoost(f.path);
    // Blend: code movement + edit frequency, scaled by what kind of file it is,
    // plus structural-entry and still-alive bonuses.
    const score =
      ((0.5 * churnN + 0.3 * commitN) * (0.6 + 0.4 * weight) +
        0.25 * boost +
        (f.alive ? 0.05 : 0)) *
      noiseMultiplier(f.path);
    return {
      path: f.path,
      role: role.role,
      category: role.category,
      churn: f.churn,
      commits: f.commits,
      score,
      reason: reasonFor(f.commits, churnRank.get(f.path) ?? 1, f.alive, boost),
      alive: f.alive,
    } satisfies KeyFile;
  });

  scored.sort((a, b) => b.score - a.score || b.churn - a.churn || a.path.localeCompare(b.path));
  return scored.slice(0, topN);
}
