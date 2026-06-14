// ---------------------------------------------------------------------------
// insights/treemap.ts — a squarified treemap layout of the codebase. The
// galaxy is cinematic; the treemap is the calm, instantly-readable counterpart:
// the whole repo at a glance, folders as blocks, files sized by churn and
// colored by type. Pure geometry (no DOM), so the layout is unit-testable; the
// component just draws the rectangles it returns.
//
// Algorithm: squarify (Bruls, Huizing & van Wijk) — greedily packs items into
// rows whose rectangles stay as close to square as possible, which keeps small
// files legible instead of slivered.
// ---------------------------------------------------------------------------

import type { FileCategory, ModuleInsight } from "./types";

export interface TreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreemapLeaf extends TreeRect {
  path: string;
  name: string;
  category: FileCategory;
  value: number;
}

export interface TreemapGroup extends TreeRect {
  dir: string;
  leaves: TreemapLeaf[];
}

interface Sized {
  value: number;
}

/** Worst aspect ratio in a row of areas laid along `side`. */
function worst(areas: number[], side: number): number {
  const sum = areas.reduce((s, a) => s + a, 0);
  if (sum <= 0) return Infinity;
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const s2 = sum * sum;
  return Math.max((side * side * max) / s2, s2 / (side * side * min));
}

/** Squarify `items` (each with a positive `value`) into the rect [x0,y0,w,h]. */
export function squarify<T extends Sized>(items: T[], x0: number, y0: number, w: number, h: number): Array<T & TreeRect> {
  const out: Array<T & TreeRect> = [];
  const positive = items.filter((i) => i.value > 0);
  if (positive.length === 0 || w <= 0 || h <= 0) return out;

  const total = positive.reduce((s, i) => s + i.value, 0);
  const scale = (w * h) / total;
  const scaled = positive
    .map((item) => ({ item, area: item.value * scale }))
    .sort((a, b) => b.area - a.area);

  let x = x0;
  let y = y0;
  let rw = w;
  let rh = h;
  let i = 0;

  while (i < scaled.length) {
    const side = Math.min(rw, rh);
    const row: { item: T; area: number }[] = [];
    const rowAreas: number[] = [];

    while (i < scaled.length) {
      const next = scaled[i];
      if (row.length === 0) {
        row.push(next);
        rowAreas.push(next.area);
        i++;
        continue;
      }
      if (worst([...rowAreas, next.area], side) <= worst(rowAreas, side)) {
        row.push(next);
        rowAreas.push(next.area);
        i++;
      } else {
        break;
      }
    }

    const rowSum = rowAreas.reduce((s, a) => s + a, 0);
    if (rw <= rh) {
      // Horizontal strip across the top of the remaining rect.
      const stripH = rowSum / rw;
      let cx = x;
      for (const r of row) {
        const cwid = r.area / stripH;
        out.push({ ...(r.item as T), x: cx, y, w: cwid, h: stripH });
        cx += cwid;
      }
      y += stripH;
      rh -= stripH;
    } else {
      // Vertical strip down the left of the remaining rect.
      const stripW = rowSum / rh;
      let cy = y;
      for (const r of row) {
        const chgt = r.area / stripW;
        out.push({ ...(r.item as T), x, y: cy, w: stripW, h: chgt });
        cy += chgt;
      }
      x += stripW;
      rw -= stripW;
    }
  }

  return out;
}

/**
 * Two-level treemap: top-level rectangles per module (sized by total file
 * churn), each subdivided into its files. A small header strip is reserved at
 * the top of each module block for its label when there's room.
 */
export function buildTreemap(
  modules: ModuleInsight[],
  width: number,
  height: number,
  headerPx = 14,
): TreemapGroup[] {
  const groups = modules
    .map((m) => ({
      dir: m.dir,
      files: m.files,
      value: m.files.reduce((s, f) => s + Math.max(1, f.churn), 0),
    }))
    .filter((g) => g.files.length > 0);

  const placed = squarify(groups, 0, 0, width, height);

  return placed.map((g) => {
    const header = Math.min(headerPx, g.h * 0.35);
    const innerY = g.y + header;
    const innerH = Math.max(0, g.h - header);
    const leafItems = g.files.map((f) => ({
      value: Math.max(1, f.churn),
      path: f.path,
      name: f.name,
      category: f.category,
    }));
    const leaves = squarify(leafItems, g.x, innerY, g.w, innerH) as TreemapLeaf[];
    return { dir: g.dir, x: g.x, y: g.y, w: g.w, h: g.h, leaves };
  });
}
