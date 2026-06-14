// ---------------------------------------------------------------------------
// insights/activity.ts — the project's "pulse." From commit dates and messages
// it derives: a cadence sparkline (commits per time slice), a work-type mix
// parsed from commit messages (feat / fix / refactor / …), the most recent
// notable changes, and a momentum read (is the project speeding up, steady,
// slowing, or dormant near the end of its history). Pure and deterministic.
// ---------------------------------------------------------------------------

import type { Commit } from "@/lib/types";
import type { ActivityInsight, CommitTypeSlice, Highlight, MomentumTrend } from "./types";

const DAY = 86_400_000;

const CONVENTIONAL = new Set([
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
]);

/** Classify a commit message into a work type. Prefers a conventional-commit
 *  prefix (`feat:`, `fix(scope):`), then falls back to keyword heuristics so
 *  non-conventional repos still get a meaningful breakdown. */
export function classifyCommit(message: string): string {
  const m = message.match(/^\s*([a-zA-Z]+)(\([^)]*\))?!?:/);
  if (m) {
    const t = m[1].toLowerCase();
    if (CONVENTIONAL.has(t)) return t;
  }
  const s = message.toLowerCase();
  if (/\b(fix|fixes|fixed|bug|bugfix|hotfix|patch)\b/.test(s)) return "fix";
  if (/\b(add|added|feature|feat|implement|introduce|support|new)\b/.test(s)) return "feat";
  if (/\b(refactor|rewrite|restructure|cleanup|clean[- ]up|simplif)/.test(s)) return "refactor";
  if (/\b(perf|performance|optimi|faster|speed)\b/.test(s)) return "perf";
  if (/\b(test|tests|spec|coverage)\b/.test(s)) return "test";
  if (/\b(doc|docs|documentation|readme|comment)\b/.test(s)) return "docs";
  if (/\b(style|format|formatting|lint|prettier|whitespace)\b/.test(s)) return "style";
  if (/\b(chore|bump|deps|dependency|dependencies|version|release|ci|build|config)\b/.test(s)) return "chore";
  return "other";
}

function commitTypeBreakdown(commits: Commit[]): CommitTypeSlice[] {
  const counts = new Map<string, number>();
  for (const c of commits) {
    const t = classifyCommit(c.message);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const total = commits.length || 1;
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function buildHighlights(commits: Commit[], topN = 6): Highlight[] {
  const byDateDesc = [...commits].sort((a, b) => b.date - a.date);
  const typed = byDateDesc.map((c) => ({ c, type: classifyCommit(c.message) }));
  const feats = typed.filter((t) => t.type === "feat");
  const fixes = typed.filter((t) => t.type === "fix");
  const picked = [...feats, ...fixes].slice(0, topN);
  return picked.map(({ c, type }) => ({
    date: c.date,
    author: c.author,
    type,
    message: c.message.length > 80 ? c.message.slice(0, 79).trimEnd() + "…" : c.message,
  }));
}

/** Commit counts per equal time slice across [first, last]. */
function activityBuckets(commits: Commit[], n = 24): number[] {
  const buckets = new Array(n).fill(0);
  if (commits.length === 0) return buckets;
  const dates = commits.map((c) => c.date);
  const first = Math.min(...dates);
  const last = Math.max(...dates);
  const span = last - first;
  for (const d of dates) {
    const idx = span <= 0 ? n - 1 : Math.min(n - 1, Math.floor(((d - first) / span) * n));
    buckets[idx]++;
  }
  return buckets;
}

function momentum(commits: Commit[]): ActivityInsight["momentum"] {
  if (commits.length === 0) return { trend: "dormant", recent: 0, prior: 0, note: "No commits." };
  const dates = commits.map((c) => c.date);
  const first = Math.min(...dates);
  const last = Math.max(...dates);
  const span = last - first;
  // Compare the final window of activity against the one before it. Window size
  // scales with the project's length (min 1 day, max 30 days).
  const win = Math.max(DAY, Math.min(DAY * 30, span > 0 ? span / 4 : DAY));
  let recent = 0;
  let prior = 0;
  for (const d of dates) {
    if (d > last - win) recent++;
    else if (d > last - 2 * win) prior++;
  }
  let trend: MomentumTrend;
  if (recent === 0) trend = "dormant";
  else if (recent >= prior * 1.3 || prior === 0) trend = "accelerating";
  else if (recent <= prior * 0.7) trend = "slowing";
  else trend = "steady";

  const days = Math.max(1, Math.round(win / DAY));
  const d = `${days} day${days === 1 ? "" : "s"}`;
  const note =
    trend === "dormant"
      ? `No commits in the final ${d} of history.`
      : `${recent} commit${recent === 1 ? "" : "s"} in the last ${d} vs ${prior} in the ${d} before — ${trend}.`;
  return { trend, recent, prior, note };
}

export function analyzeActivity(commits: Commit[]): ActivityInsight {
  return {
    buckets: activityBuckets(commits, 24),
    types: commitTypeBreakdown(commits),
    highlights: buildHighlights(commits, 6),
    momentum: momentum(commits),
  };
}
