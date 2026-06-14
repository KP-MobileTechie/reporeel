// ---------------------------------------------------------------------------
// insights/tree.ts — hierarchical representations of the file tree. One pure
// builder turns a flat file list into a nested TreeNode (folders summing their
// children's churn); two layout helpers turn that tree into things a component
// can draw directly: an indented file tree (just the nodes) and a radial
// sunburst (angular partition by value, depth as rings). Pure geometry, so the
// layouts are unit-testable.
// ---------------------------------------------------------------------------

import type { FileCategory } from "./types";

export interface TreeInput {
  path: string;
  category: FileCategory;
  value: number;
}

export interface TreeNode {
  name: string;
  path: string;
  value: number;
  category?: FileCategory;
  isFile: boolean;
  children: TreeNode[];
}

export interface SunburstArc {
  name: string;
  path: string;
  depth: number;
  startAngle: number;
  endAngle: number;
  value: number;
  category?: FileCategory;
  isFile: boolean;
}

/** Build a nested folder/file tree from flat paths; folders sum their children. */
export function buildFileTree(files: TreeInput[]): TreeNode {
  const root: TreeNode = { name: "", path: "", value: 0, isFile: false, children: [] };

  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let node = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      acc = acc ? `${acc}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: acc,
          value: isLeaf ? Math.max(0, f.value) : 0,
          category: isLeaf ? f.category : undefined,
          isFile: isLeaf,
          children: [],
        };
        node.children.push(child);
      } else if (isLeaf) {
        child.isFile = true;
        child.category = f.category;
        child.value = Math.max(0, f.value);
      }
      node = child;
    }
  }

  // Sum folder values bottom-up.
  const sum = (n: TreeNode): number => {
    if (n.isFile) return n.value;
    let s = 0;
    for (const c of n.children) s += sum(c);
    n.value = s;
    return s;
  };
  sum(root);

  // Sort: folders before files, then by value desc, then name.
  const sortRec = (n: TreeNode) => {
    n.children.sort(
      (a, b) => Number(a.isFile) - Number(b.isFile) || b.value - a.value || a.name.localeCompare(b.name),
    );
    n.children.forEach(sortRec);
  };
  sortRec(root);

  return root;
}

/**
 * Radial partition: each node gets an angular slice of its parent proportional
 * to value; depth maps to concentric rings. The root (depth 0) is the center
 * and is not emitted. Recurses to `maxDepth`.
 */
export function buildSunburst(root: TreeNode, maxDepth = 4): SunburstArc[] {
  const arcs: SunburstArc[] = [];
  const recurse = (node: TreeNode, depth: number, start: number, end: number) => {
    if (depth > 0) {
      arcs.push({
        name: node.name,
        path: node.path,
        depth,
        startAngle: start,
        endAngle: end,
        value: node.value,
        category: node.category,
        isFile: node.isFile,
      });
    }
    if (depth >= maxDepth || node.children.length === 0) return;
    const total = node.children.reduce((s, c) => s + Math.max(c.value, 1e-4), 0) || 1;
    let a = start;
    for (const c of node.children) {
      const span = (end - start) * (Math.max(c.value, 1e-4) / total);
      recurse(c, depth + 1, a, a + span);
      a += span;
    }
  };
  recurse(root, 0, 0, Math.PI * 2);
  return arcs;
}
