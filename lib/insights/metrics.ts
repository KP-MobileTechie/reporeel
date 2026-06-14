// ---------------------------------------------------------------------------
// insights/metrics.ts — extended repository metrics, all pure and derivable
// from commit metadata so they work in every mode. Commit-size distribution,
// a weekday x hour activity heatmap (UTC, for determinism), the largest
// folders by churn, and the files touched most recently. Feeds the Stats tab.
// ---------------------------------------------------------------------------

import type { Commit } from "@/lib/types";
import type { AggResult } from "./aggregate";
import { topDir } from "./aggregate";
import type { Era, RepoMetrics } from "./types";

function commitSizeDistribution(commits: Commit[]): { label: string; count: number }[] {
  const buckets = [
    { label: "1", count: 0, test: (n: number) => n <= 1 },
    { label: "2-3", count: 0, test: (n: number) => n >= 2 && n <= 3 },
    { label: "4-10", count: 0, test: (n: number) => n >= 4 && n <= 10 },
    { label: "11-30", count: 0, test: (n: number) => n >= 11 && n <= 30 },
    { label: "31+", count: 0, test: (n: number) => n >= 31 },
  ];
  for (const c of commits) {
    const n = new Set(c.changes.map((ch) => ch.toPath ?? ch.path)).size;
    for (const b of buckets) if (b.test(n)) { b.count++; break; }
  }
  return buckets.map((b) => ({ label: b.label, count: b.count }));
}

function weekdayHistogram(commits: Commit[]): number[] {
  const out = new Array(7).fill(0);
  for (const c of commits) out[new Date(c.date).getUTCDay()]++;
  return out;
}

function hourHistogram(commits: Commit[]): number[] {
  const out = new Array(24).fill(0);
  for (const c of commits) out[new Date(c.date).getUTCHours()]++;
  return out;
}

function largestDirs(agg: AggResult): { dir: string; churn: number; files: number }[] {
  const churn = new Map<string, number>();
  const files = new Map<string, number>();
  for (const f of agg.files.values()) {
    if (!f.alive) continue;
    const d = topDir(f.path);
    churn.set(d, (churn.get(d) ?? 0) + f.churn);
    files.set(d, (files.get(d) ?? 0) + 1);
  }
  return [...churn.entries()]
    .map(([dir, c]) => ({ dir, churn: c, files: files.get(dir) ?? 0 }))
    .sort((a, b) => b.churn - a.churn || a.dir.localeCompare(b.dir))
    .slice(0, 8);
}

function recentlyActive(commits: Commit[], eras: Era[]): string[] {
  if (eras.length === 0) return [];
  const last = eras[eras.length - 1];
  const seen = new Set<string>();
  const out: string[] = [];
  // Most recent commits first, collect distinct paths touched in the final era.
  for (const c of [...commits].sort((a, b) => b.date - a.date)) {
    if (c.date < last.t0) break;
    for (const ch of c.changes) {
      const p = ch.toPath ?? ch.path;
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    if (out.length >= 12) break;
  }
  return out.slice(0, 12);
}

export function computeMetrics(commits: Commit[], agg: AggResult, eras: Era[]): RepoMetrics {
  return {
    commitSizes: commitSizeDistribution(commits),
    weekday: weekdayHistogram(commits),
    hour: hourHistogram(commits),
    largestDirs: largestDirs(agg),
    recentlyActive: recentlyActive(commits, eras),
  };
}
