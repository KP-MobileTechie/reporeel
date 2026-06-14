// ---------------------------------------------------------------------------
// insights/imports.ts — parse import/require statements from source text and
// resolve them to repository file paths. This is the basis of the real
// dependency graph (local mode, where file contents are available). Pure and
// deterministic; regex-based (no AST) so it stays light and language-agnostic
// across JS/TS family files.
// ---------------------------------------------------------------------------

export interface AliasConfig {
  /** Import prefix, e.g. "@/". */
  prefix: string;
  /** Repo-relative base it maps to, e.g. "" (root) or "src". */
  base: string;
}

const PATTERNS = [
  /import\s+(?:[^'"();]*?\s+from\s+)?['"]([^'"]+)['"]/g, // import x from 'm' | import 'm'
  /export\s+(?:[^'"();]*?\s+from\s+)?['"]([^'"]+)['"]/g, // export ... from 'm'
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, // require('m')
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import('m')
];

/** Extract the set of module specifiers imported by a source file. */
export function parseImports(content: string): string[] {
  const found = new Set<string>();
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1]) found.add(m[1]);
    }
  }
  return [...found];
}

const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const INDEX = ["/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** Normalize a path with "." and ".." segments (no leading slash). */
export function normalizePath(path: string): string {
  const parts = path.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/**
 * Resolve an import specifier from `importer` to a repo file path in `fileSet`,
 * or null for bare/external packages and unresolved paths. Handles relative
 * imports and a single alias (e.g. "@/" → repo root or "src").
 */
export function resolveImport(
  importer: string,
  spec: string,
  fileSet: Set<string>,
  alias?: AliasConfig,
): string | null {
  let basePath: string | null = null;
  if (spec.startsWith("./") || spec.startsWith("../")) {
    basePath = normalizePath(`${dirname(importer)}/${spec}`);
  } else if (alias && spec.startsWith(alias.prefix)) {
    const rest = spec.slice(alias.prefix.length);
    basePath = normalizePath(alias.base ? `${alias.base}/${rest}` : rest);
  } else {
    return null; // bare specifier → external dependency
  }

  for (const ext of EXTS) {
    const cand = basePath + ext;
    if (fileSet.has(cand)) return cand;
  }
  for (const idx of INDEX) {
    const cand = basePath + idx;
    if (fileSet.has(cand)) return cand;
  }
  return null;
}
