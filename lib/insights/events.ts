// ---------------------------------------------------------------------------
// insights/events.ts — detect the structurally significant moments in a repo's
// history: big rewrites, mass cleanups, large feature drops, and contributor
// arrivals and departures. These are the beats a newcomer should know about
// ("the big refactor of last spring is why auth lives in legacy/"). Pure and
// deterministic; ranked by significance, returned in chronological order.
// ---------------------------------------------------------------------------

import type { Commit } from "@/lib/types";
import type { NotableEvent } from "./types";

const DAY = 86_400_000;

function clip(s: string, n = 70): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

export function detectEvents(commits: Commit[], topN = 8): NotableEvent[] {
  if (commits.length === 0) return [];
  const sorted = [...commits].sort((a, b) => a.date - b.date);
  const first = sorted[0].date;
  const last = sorted[sorted.length - 1].date;
  const span = last - first;

  // Per-commit shape.
  const shaped = sorted.map((c) => {
    let adds = 0;
    let dels = 0;
    let mods = 0;
    let churn = 0;
    for (const ch of c.changes) {
      churn += Math.abs(ch.delta) || 0;
      if (ch.type === "add") adds++;
      else if (ch.type === "delete") dels++;
      else if (ch.type === "modify") mods++;
    }
    return { c, adds, dels, mods, churn, files: c.changes.length };
  });

  const churns = shaped.map((s) => s.churn).sort((a, b) => a - b);
  const p90 = churns[Math.floor(churns.length * 0.9)] ?? 0;

  const scored: { ev: NotableEvent; score: number }[] = [];

  for (const s of shaped) {
    // Mass cleanup: many deletes, mostly deletions.
    if (s.dels >= 5 && s.dels >= s.files * 0.5) {
      scored.push({
        ev: { t: s.c.date, kind: "cleanup", author: s.c.author, title: "Major cleanup", detail: `${s.dels} files removed — ${clip(s.c.message)}` },
        score: 1000 + s.dels,
      });
      continue;
    }
    // Big rewrite: high churn concentrated on modifying existing files.
    if (s.churn >= p90 && s.churn > 0 && s.mods >= 3 && s.mods >= s.adds) {
      scored.push({
        ev: { t: s.c.date, kind: "rewrite", author: s.c.author, title: "Big rewrite", detail: `${s.mods} files reworked — ${clip(s.c.message)}` },
        score: 800 + s.churn,
      });
      continue;
    }
    // Large feature drop: many new files at once.
    if (s.adds >= 8) {
      scored.push({
        ev: { t: s.c.date, kind: "feature", author: s.c.author, title: "Large feature drop", detail: `${s.adds} files added — ${clip(s.c.message)}` },
        score: 600 + s.adds,
      });
    }
  }

  // Contributor arrivals and departures (only for authors with real presence).
  const byAuthor = new Map<string, { firstC: Commit; lastC: Commit; count: number }>();
  for (const c of sorted) {
    const a = byAuthor.get(c.author);
    if (!a) byAuthor.set(c.author, { firstC: c, lastC: c, count: 1 });
    else {
      a.lastC = c;
      a.count++;
    }
  }
  for (const [author, info] of byAuthor) {
    if (info.count < 3) continue;
    // Arrival (skip the very first commit of the repo — that's the founding, not a "join").
    if (info.firstC.date > first) {
      scored.push({ ev: { t: info.firstC.date, kind: "newcomer", author, title: `${author} joined`, detail: `First commit: ${clip(info.firstC.message)}` }, score: 400 + info.count });
    }
    // Departure: stopped committing well before the project's latest activity.
    if (span > 0 && info.lastC.date < last - Math.max(DAY, span * 0.3) && info.count >= 5) {
      scored.push({ ev: { t: info.lastC.date, kind: "departure", author, title: `${author}'s last commit`, detail: `After ${info.count} commits` }, score: 300 + info.count });
    }
  }

  // Keep the most significant, then present chronologically.
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topN).map((s) => s.ev);
  top.sort((a, b) => a.t - b.t);
  return top;
}
