// ---------------------------------------------------------------------------
// insights/simulate.ts — "ghost repo" what-if scenarios. Because the analysis
// is a pure fold over an immutable commit list, asking "what if this person had
// never contributed?" or "what if we deleted this folder?" is just filtering
// the commit array and re-folding. This is uniquely possible here: a tool that
// queries a live backend cannot rewind and replay history deterministically.
//
// `applyScenario` is pure (commit list in, commit list out); callers run
// buildBrief on the result and diff it against the real brief.
// ---------------------------------------------------------------------------

import type { CommitTimeline, Commit } from "@/lib/types";
import { topDir } from "./aggregate";

export interface Scenario {
  /** Pretend these authors never committed. */
  excludeAuthors?: string[];
  /** Pretend these top-level folders never existed. */
  excludeDirs?: string[];
}

/**
 * Apply a what-if scenario to a timeline, returning a new (filtered) timeline.
 * Commits by excluded authors are dropped entirely. Changes under excluded dirs
 * are stripped from the remaining commits; a commit left with no changes is
 * dropped. The original timeline is never mutated.
 */
export function applyScenario(ct: CommitTimeline, scenario: Scenario): CommitTimeline {
  const authors = new Set(scenario.excludeAuthors ?? []);
  const dirs = new Set(scenario.excludeDirs ?? []);

  const commits: Commit[] = [];
  for (const c of ct.commits) {
    if (authors.has(c.author)) continue;
    if (dirs.size === 0) {
      commits.push(c);
      continue;
    }
    const changes = c.changes.filter((ch) => {
      const from = topDir(ch.path);
      const to = ch.toPath ? topDir(ch.toPath) : from;
      return !dirs.has(from) && !dirs.has(to);
    });
    if (changes.length > 0) commits.push({ ...c, changes });
  }

  return { repo: ct.repo, commits };
}
