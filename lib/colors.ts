export type Theme = "nebula" | "ember" | "mono";

// Map file extension (lowercase, no dot) to a canonical language key.
const EXT_MAP: Record<string, string> = {
  ts: "ts",
  tsx: "ts",
  js: "js",
  jsx: "js",
  mjs: "js",
  css: "css",
  scss: "css",
  md: "md",
  json: "config",
  yml: "config",
  yaml: "config",
  py: "py",
  rs: "rs",
  go: "go",
  html: "html",
};

/** Returns the canonical language key for a file path. */
export function langOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dotIdx = base.lastIndexOf(".");
  // No dot, or dot at position 0 (dotfile with no real extension)
  if (dotIdx <= 0) return "other";
  const ext = base.slice(dotIdx + 1).toLowerCase();
  return EXT_MAP[ext] ?? "other";
}

// ---------------------------------------------------------------------------
// Color lookup tables — one RGB triple per lang key.
//
// nebula: vivid hues suitable for a dark "galaxy" background.
// ember:  warm oranges / reds / golds.
// mono:   single blue-white ramp; each lang gets a distinct lightness step.
// ---------------------------------------------------------------------------

type RGB = [number, number, number];
type LangMap = Record<string, RGB>;

const NEBULA: LangMap = {
  ts:     [0.29, 0.56, 1.00], // electric blue (TypeScript brand)
  js:     [0.98, 0.87, 0.13], // bright yellow (JS brand)
  css:    [0.82, 0.27, 0.96], // vivid violet
  md:     [0.40, 0.90, 0.55], // mint green
  config: [0.98, 0.57, 0.12], // vivid orange
  py:     [0.27, 0.76, 0.98], // sky cyan (Python brand)
  rs:     [0.96, 0.35, 0.22], // fiery red-orange (Rust brand)
  go:     [0.00, 0.78, 0.73], // teal (Go brand)
  html:   [0.98, 0.40, 0.40], // salmon-red (HTML brand)
  other:  [0.55, 0.55, 0.65], // neutral grey-blue
};

const EMBER: LangMap = {
  ts:     [0.99, 0.55, 0.10], // deep amber
  js:     [0.99, 0.75, 0.10], // golden yellow
  css:    [0.92, 0.35, 0.10], // burnt sienna
  md:     [0.99, 0.88, 0.55], // pale gold
  config: [0.85, 0.25, 0.05], // dark crimson
  py:     [0.99, 0.65, 0.30], // warm apricot
  rs:     [0.80, 0.15, 0.02], // deep red
  go:     [0.96, 0.50, 0.08], // tangerine
  html:   [0.70, 0.20, 0.00], // brick red
  other:  [0.60, 0.40, 0.25], // warm brown
};

// mono: blue-white ramp — vary lightness & slight blue shift to stay distinct.
const MONO: LangMap = {
  ts:     [0.10, 0.20, 0.80], // deepest blue
  js:     [0.20, 0.35, 0.88],
  css:    [0.30, 0.50, 0.92],
  md:     [0.40, 0.60, 0.95],
  config: [0.50, 0.68, 0.97],
  py:     [0.60, 0.75, 0.98],
  rs:     [0.68, 0.82, 0.99],
  go:     [0.78, 0.88, 1.00],
  html:   [0.88, 0.93, 1.00],
  other:  [0.93, 0.95, 1.00], // near-white
};

const THEME_MAPS: Record<Theme, LangMap> = {
  nebula: NEBULA,
  ember: EMBER,
  mono: MONO,
};

/**
 * Returns an RGB triple (values in [0, 1]) for the given lang key and theme.
 * Unknown lang keys fall back to the "other" entry.
 */
export function colorOf(lang: string, theme: Theme): RGB {
  const map = THEME_MAPS[theme];
  return map[lang] ?? map["other"];
}
