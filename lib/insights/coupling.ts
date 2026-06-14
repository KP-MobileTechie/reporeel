// ---------------------------------------------------------------------------
// insights/coupling.ts — mine "temporal coupling" from history: pairs of files
// that keep changing in the same commit. High coupling between files in
// different folders is exactly the hidden relationship a newcomer can't see
// from the tree alone ("touch the parser and you always touch the schema").
//
// Score = co-changes / min(individual changes), so 1.0 means two files have
// never moved apart. Giant commits (sweeping renames, formatting) are skipped
// so they don't manufacture spurious links. Pair counts are stored in a nested
// map (no string-concatenated keys), so paths with any characters are safe.
// ---------------------------------------------------------------------------

import type { Commit } from "@/lib/types";
import type { CouplingPair } from "./types";

const MAX_FILES_PER_COMMIT = 25;

export function detectCoupling(commits: Commit[], alivePaths?: Set<string>, topN = 8): CouplingPair[] {
  const indiv = new Map<string, number>();
  // a -> b -> count, with a < b enforced so each unordered pair is stored once.
  const pairCount = new Map<string, Map<string, number>>();

  const bump = (a: string, b: string) => {
    let inner = pairCount.get(a);
    if (!inner) pairCount.set(a, (inner = new Map()));
    inner.set(b, (inner.get(b) ?? 0) + 1);
  };

  for (const c of commits) {
    // Canonical current path (rename target wins) and de-duplicate within a commit.
    const paths = [...new Set(c.changes.map((ch) => ch.toPath ?? ch.path))];
    for (const p of paths) indiv.set(p, (indiv.get(p) ?? 0) + 1);
    if (paths.length < 2 || paths.length > MAX_FILES_PER_COMMIT) continue;

    paths.sort();
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        bump(paths[i], paths[j]); // paths[i] < paths[j] after sort
      }
    }
  }

  const out: CouplingPair[] = [];
  for (const [a, inner] of pairCount) {
    if (alivePaths && !alivePaths.has(a)) continue;
    for (const [b, together] of inner) {
      if (together < 2) continue;
      if (alivePaths && !alivePaths.has(b)) continue;
      const score = together / Math.max(1, Math.min(indiv.get(a) ?? 1, indiv.get(b) ?? 1));
      if (score < 0.4) continue;
      out.push({ a, b, together, score });
    }
  }

  out.sort((x, y) => y.score - x.score || y.together - x.together || x.a.localeCompare(y.a));
  return out.slice(0, topN);
}
