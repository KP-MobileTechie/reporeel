// ---------------------------------------------------------------------------
// insights/risk.ts — the manager / lead view. From the same aggregates it
// derives a project-health read: the bus factor (how many people together
// account for over half the commits), the biggest single committer's share,
// who owns each folder, and the files most exposed to maintenance risk
// (high churn concentrated in one or two hands). Everything is phrased in
// plain language a non-author can act on.
// ---------------------------------------------------------------------------

import type { AggResult } from "./aggregate";
import type { FileCategory, OwnershipEntry, RiskAnalysis, RiskFile } from "./types";
import { roleOf, isGeneratedPath } from "./fileRoles";

// Hotspots are about CODE that's hard to maintain — not generated lockfiles,
// docs or config. Restrict to the categories a maintainer actually owns.
const HOTSPOT_CATEGORIES = new Set<FileCategory>(["ui", "logic", "engine"]);

export function analyzeRisk(agg: AggResult): RiskAnalysis {
  const authors = [...agg.authors.values()];
  const totalCommits = authors.reduce((s, a) => s + a.commits, 0) || 1;
  const byCommits = [...authors].sort((a, b) => b.commits - a.commits || a.author.localeCompare(b.author));

  // Bus factor: smallest set of people accounting for > 50% of commits.
  let acc = 0;
  let busFactor = 0;
  for (const a of byCommits) {
    acc += a.commits;
    busFactor++;
    if (acc / totalCommits > 0.5) break;
  }

  const keyPerson = byCommits[0]
    ? { author: byCommits[0].author, sharePct: Math.round((byCommits[0].commits / totalCommits) * 100) }
    : null;

  // Ownership per folder, by share of churn contributed there.
  const dirChurn = new Map<string, Map<string, number>>();
  for (const a of authors) {
    for (const [dir, churn] of a.dirs) {
      if (dir === "(root)" || churn <= 0) continue;
      let m = dirChurn.get(dir);
      if (!m) dirChurn.set(dir, (m = new Map()));
      m.set(a.author, (m.get(a.author) ?? 0) + churn);
    }
  }
  const ownership: OwnershipEntry[] = [];
  for (const [dir, m] of dirChurn) {
    const tot = [...m.values()].reduce((s, v) => s + v, 0) || 1;
    const [owner, ch] = [...m.entries()].sort((x, y) => y[1] - x[1])[0];
    ownership.push({ dir, owner, sharePct: Math.round((ch / tot) * 100) });
  }
  ownership.sort((a, b) => b.sharePct - a.sharePct || a.dir.localeCompare(b.dir));

  // Hotspots: live CODE files with high churn relative to how many people touch
  // them (generated files and non-code are excluded — they aren't a risk to own).
  const alive = [...agg.files.values()].filter(
    (f) => f.alive && f.churn > 0 && !isGeneratedPath(f.path) && HOTSPOT_CATEGORIES.has(roleOf(f.path).category),
  );
  const maxChurn = Math.max(1, ...alive.map((f) => f.churn));
  const scored = alive
    .map((f) => ({ f, risk: (f.churn / maxChurn) * (1 / f.authors.size) }))
    .sort((a, b) => b.risk - a.risk || b.f.churn - a.f.churn || a.f.path.localeCompare(b.f.path));
  const hotspots: RiskFile[] = scored.slice(0, 5).map(({ f }) => ({
    path: f.path,
    role: roleOf(f.path).role,
    churn: f.churn,
    authors: f.authors.size,
    note: f.authors.size === 1 ? "high churn, single maintainer" : `high churn, ${f.authors.size} maintainers`,
  }));

  // Stale: live code files not touched in the older half of the timeline. A
  // file last edited long before the project's most recent work is a candidate
  // for "is this still used / does anyone remember it?".
  const allFiles = [...agg.files.values()];
  const lastSeen = Math.max(0, ...allFiles.map((f) => f.lastSeen));
  const firstSeen = Math.min(...allFiles.map((f) => f.firstSeen).filter((n) => Number.isFinite(n)));
  const span = lastSeen - firstSeen;
  const staleBefore = lastSeen - span * 0.5;
  const stale: RiskFile[] = span > 0
    ? allFiles
        .filter((f) => f.alive && f.churn > 0 && f.lastSeen < staleBefore && HOTSPOT_CATEGORIES.has(roleOf(f.path).category))
        .sort((a, b) => a.lastSeen - b.lastSeen || b.churn - a.churn)
        .slice(0, 5)
        .map((f) => ({
          path: f.path,
          role: roleOf(f.path).role,
          churn: f.churn,
          authors: f.authors.size,
          note: `last changed ${new Date(f.lastSeen).toISOString().slice(0, 10)}`,
        }))
    : [];

  // Plain-language findings.
  const notes: string[] = [];
  if (authors.length === 1) {
    notes.push(
      `Every commit is by one person (${byCommits[0].author}): maximum key-person risk. Pulling in a second reviewer would de-risk it.`,
    );
  } else {
    notes.push(
      `Work spreads across ${authors.length} contributors; the bus factor is ${busFactor} (people who together made over half the commits).`,
    );
    if (keyPerson && keyPerson.sharePct >= 70) {
      notes.push(`${keyPerson.author} authored ${keyPerson.sharePct}% of commits: consider sharing ownership.`);
    }
  }
  const single = hotspots.filter((h) => h.authors === 1).length;
  if (single > 0 && authors.length > 1) {
    notes.push(
      `${single} high-churn file${single === 1 ? "" : "s"} ${single === 1 ? "is" : "are"} maintained by a single person: likely where complexity and risk concentrate.`,
    );
  }

  const busFactorNote =
    busFactor <= 1
      ? "Fragile: losing one person would stall the project."
      : busFactor <= 2
        ? "Concentrated: knowledge sits with very few people."
        : "Reasonably distributed across the team.";

  return { busFactor, busFactorNote, keyPerson, ownership: ownership.slice(0, 8), hotspots, stale, notes };
}
