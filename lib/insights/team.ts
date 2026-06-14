// ---------------------------------------------------------------------------
// insights/team.ts — contributor fingerprinting & team topology, from commit
// metadata alone (no file contents), so it works in every mode including the
// demo gallery. Two layers:
//
//   Fingerprints — HOW each person works: commit size (surgical vs sweeping)
//   and breadth (specialist vs generalist), plus the folders they live in.
//
//   Topology — HOW the team connects: file-set overlap (Jaccard) gives a
//   collaboration graph. Its connected components are potential silos; its
//   articulation points are knowledge brokers (people whose departure would
//   fragment the team). All deterministic and unit-testable.
// ---------------------------------------------------------------------------

import type { Commit } from "@/lib/types";
import type { ContributorFingerprint, TeamLink, TeamTopology } from "./types";
import { topDir } from "./aggregate";

// A pair shares an edge in the collaboration graph at this many shared files.
const EDGE_SHARED_FILES = 2;

interface AuthorAcc {
  author: string;
  commits: number;
  churn: number;
  fileTouchEvents: number;
  files: Set<string>;
  dirs: Set<string>;
  dirCounts: Map<string, number>;
  fileCounts: Map<string, number>;
  firstCommit: number;
  lastCommit: number;
}

function styleLabel(size: string, breadth: string): string {
  const sizeWord = size === "surgical" ? "Surgical" : size === "sweeping" ? "Sweeping" : "Measured";
  const breadthWord = breadth === "specialist" ? "specialist" : "generalist";
  return `${sizeWord} ${breadthWord}`;
}

export function analyzeTeam(commits: Commit[]): TeamTopology {
  const accs = new Map<string, AuthorAcc>();
  for (const c of commits) {
    let a = accs.get(c.author);
    if (!a) {
      a = {
        author: c.author, commits: 0, churn: 0, fileTouchEvents: 0, files: new Set(), dirs: new Set(),
        dirCounts: new Map(), fileCounts: new Map(), firstCommit: c.date, lastCommit: c.date,
      };
      accs.set(c.author, a);
    }
    a.commits++;
    a.firstCommit = Math.min(a.firstCommit, c.date);
    a.lastCommit = Math.max(a.lastCommit, c.date);
    const paths = new Set(c.changes.map((ch) => ch.toPath ?? ch.path));
    a.fileTouchEvents += paths.size;
    for (const p of paths) {
      a.files.add(p);
      a.fileCounts.set(p, (a.fileCounts.get(p) ?? 0) + 1);
      const d = topDir(p);
      a.dirs.add(d);
      a.dirCounts.set(d, (a.dirCounts.get(d) ?? 0) + 1);
    }
    for (const ch of c.changes) a.churn += Math.abs(ch.delta) || 0;
  }

  const authors = [...accs.values()].sort((x, y) => y.commits - x.commits || x.author.localeCompare(y.author));

  const fingerprints: ContributorFingerprint[] = authors.map((a) => {
    const avg = a.commits ? a.fileTouchEvents / a.commits : 0;
    const size = avg <= 3 ? "surgical" : avg >= 10 ? "sweeping" : "measured";
    const breadth = a.dirs.size <= 2 ? "specialist" : "generalist";
    const topAreas = [...a.dirCounts.entries()]
      .filter(([d]) => d !== "(root)")
      .sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]))
      .slice(0, 3)
      .map(([d]) => d);
    const topFiles = [...a.fileCounts.entries()]
      .sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]))
      .slice(0, 5)
      .map(([f]) => f);
    return {
      author: a.author,
      commits: a.commits,
      churn: a.churn,
      filesTouched: a.files.size,
      dirsTouched: a.dirs.size,
      avgCommitSize: Math.round(avg * 10) / 10,
      style: styleLabel(size, breadth),
      styleTags: [size, breadth],
      topAreas,
      firstCommit: a.firstCommit,
      lastCommit: a.lastCommit,
      topFiles,
    };
  });

  // ── Collaboration graph from file-set overlap ───────────────────────────────
  const links: TeamLink[] = [];
  const adj = new Map<string, Set<string>>();
  for (const a of authors) adj.set(a.author, new Set());
  for (let i = 0; i < authors.length; i++) {
    for (let j = i + 1; j < authors.length; j++) {
      const A = authors[i];
      const B = authors[j];
      let shared = 0;
      const [small, big] = A.files.size <= B.files.size ? [A.files, B.files] : [B.files, A.files];
      for (const f of small) if (big.has(f)) shared++;
      if (shared === 0) continue;
      const union = A.files.size + B.files.size - shared;
      const jaccard = union > 0 ? shared / union : 0;
      links.push({ a: A.author, b: B.author, sharedFiles: shared, jaccard: Math.round(jaccard * 100) / 100 });
      if (shared >= EDGE_SHARED_FILES) {
        adj.get(A.author)!.add(B.author);
        adj.get(B.author)!.add(A.author);
      }
    }
  }
  links.sort((x, y) => y.sharedFiles - x.sharedFiles || y.jaccard - x.jaccard || x.a.localeCompare(y.a));

  const nodes = authors.map((a) => a.author);
  const comps = connectedComponents(nodes, adj);
  const brokers = articulationPoints(nodes, adj);
  const silos = comps.length > 1 ? comps : [];

  // ── Plain-language summary ──────────────────────────────────────────────────
  let note: string;
  if (authors.length <= 1) {
    note = "Single contributor — no team topology to map.";
  } else {
    const parts: string[] = [`${authors.length} contributors.`];
    if (comps.length > 1) parts.push(`${comps.length} groups never touch the same files (possible silos).`);
    else parts.push("Everyone's work overlaps into one connected group.");
    if (brokers.length) {
      parts.push(
        `${brokers.join(", ")} bridge${brokers.length === 1 ? "s" : ""} otherwise-separable areas — key knowledge broker${brokers.length === 1 ? "" : "s"}.`,
      );
    }
    note = parts.join(" ");
  }

  return { fingerprints, concentration: concentrationOf(fingerprints), links: links.slice(0, 12), silos, brokers, note };
}

/** Gini-based concentration of commits across contributors. */
function concentrationOf(fps: ContributorFingerprint[]): { gini: number; topShare: number; note: string } {
  const commits = fps.map((f) => f.commits);
  const total = commits.reduce((s, n) => s + n, 0);
  if (fps.length <= 1 || total === 0) {
    return { gini: fps.length <= 1 ? 1 : 0, topShare: 100, note: fps.length <= 1 ? "Single contributor." : "—" };
  }
  const v = [...commits].sort((a, b) => a - b);
  const n = v.length;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * v[i];
  const gini = Math.max(0, Math.min(1, (2 * cum) / (n * total) - (n + 1) / n));
  const topShare = Math.round((Math.max(...commits) / total) * 100);
  const note =
    gini >= 0.6
      ? "Highly concentrated — a few people do most of the work."
      : gini >= 0.4
        ? "Moderately concentrated."
        : "Fairly evenly distributed across the team.";
  return { gini: Math.round(gini * 100) / 100, topShare, note };
}

/** Connected components of an undirected graph, deterministic ordering. */
function connectedComponents(nodes: string[], adj: Map<string, Set<string>>): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const start of nodes) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const u = stack.pop()!;
      comp.push(u);
      for (const v of [...(adj.get(u) ?? [])].sort()) {
        if (!seen.has(v)) {
          seen.add(v);
          stack.push(v);
        }
      }
    }
    out.push(comp.sort());
  }
  return out.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

/** Articulation points (Tarjan): nodes whose removal increases component count. */
function articulationPoints(nodes: string[], adj: Map<string, Set<string>>): string[] {
  const visited = new Set<string>();
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const ap = new Set<string>();
  let timer = 0;

  const dfs = (u: string, parent: string | null) => {
    visited.add(u);
    disc.set(u, timer);
    low.set(u, timer);
    timer++;
    let children = 0;
    for (const v of [...(adj.get(u) ?? [])].sort()) {
      if (!visited.has(v)) {
        children++;
        dfs(v, u);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        if (parent !== null && low.get(v)! >= disc.get(u)!) ap.add(u);
      } else if (v !== parent) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      }
    }
    if (parent === null && children > 1) ap.add(u);
  };

  for (const n of [...nodes].sort()) if (!visited.has(n)) dfs(n, null);
  return [...ap].sort();
}
