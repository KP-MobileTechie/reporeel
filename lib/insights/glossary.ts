// ---------------------------------------------------------------------------
// insights/glossary.ts — the project's domain vocabulary, mined from file and
// folder names. Splitting identifiers on camelCase / kebab / snake / dots and
// counting how many distinct files each term appears in surfaces the words a
// newcomer keeps seeing ("supernova", "timeline", "layout", "scene"). Pure and
// deterministic; a generous stoplist removes boilerplate and language noise.
// ---------------------------------------------------------------------------

import type { GlossaryTerm } from "./types";

const STOP = new Set([
  // structure / boilerplate
  "src", "lib", "app", "index", "main", "test", "tests", "spec", "specs", "config", "configs",
  "util", "utils", "helper", "helpers", "common", "core", "shared", "components", "component",
  "pages", "page", "public", "assets", "asset", "static", "dist", "build", "out", "node",
  "modules", "types", "type", "hooks", "hook", "styles", "style", "docs", "doc", "scripts", "script",
  "api", "server", "client", "view", "views", "screen", "screens", "model", "models", "service",
  "services", "controller", "controllers", "route", "routes", "store", "stores", "data", "constants",
  // extensions / langs
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "css", "scss", "md", "mdx", "json", "yml", "yaml", "html",
  "py", "rs", "go", "java", "kt", "rb", "php", "svg", "png", "jpg", "txt", "lock", "map", "min", "d",
  // generic words
  "the", "and", "for", "with", "use", "get", "set", "new", "old", "tmp", "temp", "file", "files",
  "default", "global", "globals", "base", "init", "setup", "test", "mock", "mocks", "fixture", "fixtures",
]);

function tokenize(path: string): Set<string> {
  const out = new Set<string>();
  for (const seg of path.split("/")) {
    // Drop the extension chain, then split on case / separators.
    const stem = seg.includes(".") ? seg.slice(0, seg.indexOf(".")) : seg;
    const parts = stem
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase boundary
      .replace(/[-_.]+/g, " ")
      .toLowerCase()
      .split(/\s+/);
    for (const p of parts) {
      if (p.length >= 3 && !STOP.has(p) && !/^\d+$/.test(p)) out.add(p);
    }
  }
  return out;
}

/** Build the domain glossary: terms ranked by how many files mention them. */
export function buildGlossary(alivePaths: string[], topN = 16): GlossaryTerm[] {
  const counts = new Map<string, number>();
  for (const path of alivePaths) {
    for (const term of tokenize(path)) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2) // appears in at least two files
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, topN);
}
