// ---------------------------------------------------------------------------
// insights/eras.ts — segment a project's history into a handful of contiguous
// "eras" so the story has chapters. Splitting by equal commit COUNT (not equal
// time) keeps each chapter meaningful: a quiet year and a busy week each get
// their fair share. Each era is labeled by what dominated it (engine, UI,
// tests, …) and summarized from its top directories and authors.
// ---------------------------------------------------------------------------

import type { Commit } from "@/lib/types";
import type { Era, FileCategory } from "./types";
import { roleOf } from "./fileRoles";
import { topDir } from "./aggregate";

const LABEL_BY_CATEGORY: Record<FileCategory, string> = {
  engine: "Engine build-out",
  logic: "Core logic",
  ui: "UI build-out",
  test: "Hardening",
  config: "Tooling & setup",
  build: "Tooling & setup",
  docs: "Documentation",
  style: "Styling",
  data: "Data wiring",
  asset: "Assets",
  other: "General work",
};

function dominantCategory(commits: Commit[]): FileCategory {
  const churn = new Map<FileCategory, number>();
  for (const c of commits) {
    for (const ch of c.changes) {
      const cat = roleOf(ch.path).category;
      churn.set(cat, (churn.get(cat) ?? 0) + (Math.abs(ch.delta) || 0));
    }
  }
  let best: FileCategory = "other";
  let bestN = -1;
  for (const [k, n] of churn) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

function topByChurn(commits: Commit[]): string[] {
  const churn = new Map<string, number>();
  for (const c of commits)
    for (const ch of c.changes)
      churn.set(topDir(ch.path), (churn.get(topDir(ch.path)) ?? 0) + (Math.abs(ch.delta) || 0));
  return [...churn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
}

function topAuthors(commits: Commit[]): string[] {
  const counts = new Map<string, number>();
  for (const c of commits) counts.set(c.author, (counts.get(c.author) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => e[0]);
}

/**
 * Segment commits into up to `maxEras` contiguous eras of roughly equal commit
 * count. Eras tile the full [firstCommit, lastCommit] window: era[i].t1 ===
 * era[i+1].t0, and the last era ends at the final commit's date.
 */
export function detectEras(commits: Commit[], maxEras = 5): Era[] {
  const sorted = [...commits].sort((a, b) => a.date - b.date);
  const n = sorted.length;
  if (n === 0) return [];

  const eraCount = Math.max(1, Math.min(maxEras, Math.ceil(n / 3)));
  const per = Math.ceil(n / eraCount);

  const labelSeen = new Map<string, number>();
  const uniqueLabel = (base: string): string => {
    const seen = labelSeen.get(base) ?? 0;
    labelSeen.set(base, seen + 1);
    if (seen === 0) return base;
    const numerals = ["", " II", " III", " IV", " V"];
    return base + (numerals[seen] ?? ` ${seen + 1}`);
  };

  const eras: Era[] = [];
  for (let i = 0; i < eraCount; i++) {
    const start = i * per;
    const end = Math.min(n, start + per);
    if (start >= end) break;
    const chunk = sorted.slice(start, end);
    const idx = eras.length;
    const cat = dominantCategory(chunk);
    const dirs = topByChurn(chunk);
    const authors = topAuthors(chunk);

    const label = idx === 0 ? "Foundation" : uniqueLabel(LABEL_BY_CATEGORY[cat]);
    const where = dirs[0] && dirs[0] !== "(root)" ? ` centered on \`${dirs[0]}\`` : "";
    const who = authors.length === 1 ? `${authors[0]} drove it` : authors.length > 1 ? `${authors[0]} and ${authors[1]} drove it` : "";
    const summary = `${chunk.length} commit${chunk.length === 1 ? "" : "s"}${where}.${who ? ` ${who}.` : ""}`;

    eras.push({
      index: idx,
      t0: chunk[0].date,
      t1: chunk[chunk.length - 1].date,
      label,
      summary,
      commitCount: chunk.length,
      topDirs: dirs,
      topAuthors: authors,
    });
  }

  // Tile the windows so eras are contiguous for the scrubber: each era starts
  // where it began and ends where the next begins (last ends at final commit).
  for (let i = 0; i < eras.length; i++) {
    eras[i].t1 = i + 1 < eras.length ? eras[i + 1].t0 : sorted[n - 1].date;
  }
  eras[0].t0 = sorted[0].date;

  return eras;
}
