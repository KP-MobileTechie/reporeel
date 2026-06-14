// ---------------------------------------------------------------------------
// insights/narration.ts — turn the brief's structure into time-keyed captions
// that play under the galaxy (live and in the exported video). Beats are sorted
// by time; `activeBeat` picks the latest beat whose time has passed, so the
// caption always reflects the current moment on the scrubber.
// ---------------------------------------------------------------------------

import type { Commit } from "@/lib/types";
import type { Era, NarrationBeat } from "./types";
import { roleOf } from "./fileRoles";

const MAX_BEATS = 14;

function clip(s: string, n = 90): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

/**
 * Build the narration track from the project's headline, its eras, and notable
 * commits. Produces an intro, one beat per era, a few milestone beats for the
 * largest commits, an event beat when tests first appear, and an outro.
 */
export function buildNarration(
  headline: string,
  eras: Era[],
  commits: Commit[],
  firstCommit: number,
  lastCommit: number,
): NarrationBeat[] {
  const beats: NarrationBeat[] = [];
  const sorted = [...commits].sort((a, b) => a.date - b.date);

  // Intro at the very first commit.
  beats.push({ t: firstCommit, kind: "intro", text: headline });

  // One beat per era (skip era 0 — the intro already owns that moment).
  for (const e of eras) {
    if (e.index === 0) continue;
    beats.push({ t: e.t0, kind: "era", text: `${e.label}: ${clip(e.summary, 70)}` });
  }

  // First appearance of a test file → a callout.
  const firstTest = sorted.find((c) => c.changes.some((ch) => roleOf(ch.path).category === "test"));
  if (firstTest) {
    beats.push({ t: firstTest.date, kind: "event", text: "First tests appear — the project starts proving itself." });
  }

  // Milestone beats: the 3 biggest commits by total churn.
  const byChurn = sorted
    .map((c) => ({ c, churn: c.changes.reduce((s, ch) => s + (Math.abs(ch.delta) || 0), 0) }))
    .sort((a, b) => b.churn - a.churn)
    .slice(0, 3);
  for (const { c, churn } of byChurn) {
    if (churn <= 0) continue;
    beats.push({ t: c.date, kind: "milestone", text: clip(`${c.author}: ${c.message}`) });
  }

  // Outro at the last commit.
  beats.push({ t: lastCommit, kind: "outro", text: "The repo today — every star a file, every burst a commit." });

  // Sort, then drop near-duplicate timestamps keeping the higher-priority kind.
  const priority: Record<NarrationBeat["kind"], number> = {
    intro: 0,
    outro: 1,
    era: 2,
    milestone: 3,
    event: 4,
  };
  beats.sort((a, b) => a.t - b.t || priority[a.kind] - priority[b.kind]);

  const deduped: NarrationBeat[] = [];
  for (const b of beats) {
    const prev = deduped[deduped.length - 1];
    if (prev && b.t === prev.t) continue; // same instant: keep the first (higher priority)
    deduped.push(b);
  }

  // Cap the count, always keeping intro + outro.
  if (deduped.length <= MAX_BEATS) return deduped;
  const intro = deduped[0];
  const outro = deduped[deduped.length - 1];
  const middle = deduped.slice(1, -1);
  const keep = Math.max(0, MAX_BEATS - 2);
  const step = middle.length / keep;
  const sampled: NarrationBeat[] = [];
  for (let i = 0; i < keep; i++) sampled.push(middle[Math.floor(i * step)]);
  return [intro, ...sampled, outro];
}

/**
 * The active beat at time `t`: the latest beat with beat.t <= t (binary
 * search). Returns null only for an empty track or a `t` before the first beat.
 */
export function activeBeat(beats: NarrationBeat[], t: number): NarrationBeat | null {
  if (beats.length === 0) return null;
  let lo = 0;
  let hi = beats.length; // find first index with beats[i].t > t
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (beats[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? null : beats[lo - 1];
}
