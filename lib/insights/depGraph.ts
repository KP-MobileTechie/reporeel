// ---------------------------------------------------------------------------
// insights/depGraph.ts — build a real module dependency graph from source file
// contents (available in local mode). Edges are import relationships, resolved
// to repo paths. From the graph it derives the files everything depends on
// (the core), the most entangled files (most dependencies), isolated files,
// and import cycles. Pure and deterministic.
// ---------------------------------------------------------------------------

import type { AliasConfig } from "./imports";
import { parseImports, resolveImport } from "./imports";
import type { DepGraph } from "./types";

const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;

/**
 * Build the dependency graph from a path→content map. `alias` maps an import
 * prefix (default "@/") to a repo base; pass the project's real alias if known.
 */
export function buildDepGraph(contents: Map<string, string>, alias: AliasConfig = { prefix: "@/", base: "" }): DepGraph {
  const fileSet = new Set([...contents.keys()].filter((p) => SOURCE_RE.test(p)));
  const adj = new Map<string, Set<string>>();
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const f of fileSet) {
    adj.set(f, new Set());
    inDeg.set(f, 0);
    outDeg.set(f, 0);
  }

  let edgeCount = 0;
  for (const path of fileSet) {
    const content = contents.get(path)!;
    for (const spec of parseImports(content)) {
      const target = resolveImport(path, spec, fileSet, alias);
      if (target && target !== path && !adj.get(path)!.has(target)) {
        adj.get(path)!.add(target);
        outDeg.set(path, (outDeg.get(path) ?? 0) + 1);
        inDeg.set(target, (inDeg.get(target) ?? 0) + 1);
        edgeCount++;
      }
    }
  }

  const files = [...fileSet];
  const mostDependedOn = files
    .map((path) => ({ path, count: inDeg.get(path) ?? 0 }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, 8);
  const mostDependencies = files
    .map((path) => ({ path, count: outDeg.get(path) ?? 0 }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, 8);
  const orphans = files.filter((p) => (inDeg.get(p) ?? 0) === 0 && (outDeg.get(p) ?? 0) === 0);

  return {
    available: fileSet.size > 0,
    nodeCount: fileSet.size,
    edgeCount,
    mostDependedOn,
    mostDependencies,
    orphans: orphans.slice(0, 12),
    cycles: findCycles(adj, files),
    edges: collectEdges(adj),
  };
}

/** Collect edges as [from, to] pairs (capped for the UI graph). */
function collectEdges(adj: Map<string, Set<string>>): [string, string][] {
  const out: [string, string][] = [];
  for (const [from, tos] of adj) for (const to of tos) out.push([from, to]);
  return out;
}

/** Find a few import cycles (DFS back-edges). Returns short cycle paths. */
function findCycles(adj: Map<string, Set<string>>, files: string[]): string[][] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const f of files) color.set(f, WHITE);
  const stack: string[] = [];
  const cycles: string[][] = [];

  const dfs = (u: string) => {
    if (cycles.length >= 5) return;
    color.set(u, GRAY);
    stack.push(u);
    for (const v of [...(adj.get(u) ?? [])].sort()) {
      if (cycles.length >= 5) break;
      if (color.get(v) === GRAY) {
        const idx = stack.indexOf(v);
        if (idx >= 0) cycles.push(stack.slice(idx).concat(v));
      } else if (color.get(v) === WHITE) {
        dfs(v);
      }
    }
    stack.pop();
    color.set(u, BLACK);
  };

  for (const f of [...files].sort()) if (color.get(f) === WHITE) dfs(f);
  return cycles;
}
