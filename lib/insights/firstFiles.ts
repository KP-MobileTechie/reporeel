// ---------------------------------------------------------------------------
// insights/firstFiles.ts — suggest approachable files for a newcomer's first
// change. Good first files are real code (not config/docs), modestly sized
// (not trivial, not a monster), maintained by few people, not maintenance
// hotspots, and loosely coupled (a small blast radius). Pure and deterministic.
//
// Framed as "approachable starting points", not a guarantee — it surfaces low-
// risk places to learn the codebase, derived from churn and coupling alone.
// ---------------------------------------------------------------------------

import type { AggResult } from "./aggregate";
import type { CouplingPair, FileEntry, FirstFile, ModuleInsight, RiskFile } from "./types";
import { roleOf, isGeneratedPath } from "./fileRoles";

const CODE = new Set(["ui", "logic", "engine", "style"]);

export function suggestFirstFiles(
  agg: AggResult,
  modules: ModuleInsight[],
  hotspots: RiskFile[],
  coupling: CouplingPair[],
  topN = 5,
): FirstFile[] {
  const hotset = new Set(hotspots.map((h) => h.path));
  const coupled = new Set(coupling.flatMap((c) => [c.a, c.b]));
  const roleByPath = new Map<string, FileEntry>();
  for (const m of modules) for (const f of m.files) roleByPath.set(f.path, f);

  const candidates = [...agg.files.values()].filter(
    (f) =>
      f.alive &&
      f.churn > 0 &&
      !isGeneratedPath(f.path) &&
      !hotset.has(f.path) &&
      CODE.has(roleOf(f.path).category),
  );
  if (candidates.length === 0) return [];

  // Median churn → prefer files near it (substantial enough to matter, small
  // enough to grasp).
  const sortedChurn = candidates.map((c) => c.churn).sort((a, b) => a - b);
  const median = sortedChurn[Math.floor(sortedChurn.length / 2)] || 1;

  const scored = candidates.map((f) => {
    const churnDistance = Math.abs(Math.log((f.churn || 1) / median)); // 0 at median
    const authorPenalty = (f.authors.size - 1) * 0.4; // prefer 1-2 maintainers
    const couplingPenalty = coupled.has(f.path) ? 0.6 : 0; // prefer low blast radius
    const score = -(churnDistance + authorPenalty + couplingPenalty);
    return { f, score };
  });
  scored.sort((a, b) => b.score - a.score || a.f.path.localeCompare(b.f.path));

  return scored.slice(0, topN).map(({ f }) => {
    const reasons: string[] = ["modest size"];
    reasons.push(f.authors.size === 1 ? "single maintainer" : `${f.authors.size} maintainers`);
    if (!coupled.has(f.path)) reasons.push("low coupling");
    const entry = roleByPath.get(f.path);
    return { path: f.path, role: entry?.role ?? roleOf(f.path).role, why: reasons.join(", ") };
  });
}
