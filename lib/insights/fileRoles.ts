// ---------------------------------------------------------------------------
// insights/fileRoles.ts — infer a human-readable role + category for a path.
//
// Pure and deterministic. Rules are ordered most-specific-first: exact known
// basenames, then test detection, then first-segment conventions (app/, lib/,
// engine/, …), then an extension fallback. The goal is a label a newcomer can
// read ("Rendering engine", "Page route", "Type definitions") rather than a
// raw filename.
// ---------------------------------------------------------------------------

import type { FileCategory, FileRole } from "./types";

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

function stem(name: string): string {
  const dot = name.indexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Turn "use-galaxy" / "exportModal" into a readable token for labels. */
function pretty(name: string): string {
  return name;
}

const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/i;

/**
 * Generated / vendored files (lockfiles, minified bundles, source maps,
 * snapshots). They churn enormously but carry no authored meaning, so the
 * size-based visualizations (treemap, sunburst) exclude them to avoid a
 * lockfile swallowing the whole picture.
 */
export function isGeneratedPath(path: string): boolean {
  const base = (path.split("/").pop() ?? "").toLowerCase();
  if (base.endsWith(".lock")) return true; // yarn.lock, Cargo.lock, poetry.lock, Gemfile.lock, composer.lock
  if (base.endsWith("-lock.json")) return true; // package-lock.json and friends
  if (base === "pnpm-lock.yaml" || base === "bun.lockb" || base === "go.sum") return true;
  if (/\.min\.(js|css)$/.test(base)) return true;
  if (base.endsWith(".map") || base.endsWith(".snap")) return true;
  return false;
}

/** Is this path part of the test surface (by directory or filename)? */
export function isTestPath(path: string): boolean {
  if (TEST_RE.test(baseName(path))) return true;
  return /(^|\/)(tests?|__tests__|__mocks__|e2e|spec)(\/|$)/i.test(path);
}

const EXACT: Record<string, [FileCategory, string]> = {
  "package.json": ["config", "Dependency manifest"],
  "package-lock.json": ["config", "Lockfile"],
  "pnpm-lock.yaml": ["config", "Lockfile"],
  "yarn.lock": ["config", "Lockfile"],
  "bun.lockb": ["config", "Lockfile"],
  "license": ["docs", "License"],
  "license.md": ["docs", "License"],
  "license.txt": ["docs", "License"],
  ".gitignore": ["config", "Git ignore rules"],
  ".gitattributes": ["config", "Git attributes"],
  ".npmrc": ["config", "npm config"],
  ".nvmrc": ["config", "Node version"],
  "dockerfile": ["build", "Docker image"],
  "docker-compose.yml": ["build", "Docker Compose"],
  "makefile": ["build", "Makefile"],
  "cargo.toml": ["config", "Rust manifest"],
  "go.mod": ["config", "Go module"],
  "pyproject.toml": ["config", "Python project"],
  "requirements.txt": ["config", "Python dependencies"],
  "vercel.json": ["config", "Vercel config"],
  "next-env.d.ts": ["config", "Next.js type shim"],
  "robots.txt": ["asset", "Robots directives"],
};

/**
 * Infer the role and category of a single file path. Never throws; unknown
 * shapes fall back to a generic label by extension.
 */
export function roleOf(path: string): FileRole {
  const name = baseName(path);
  const lower = name.toLowerCase();
  const ext = extOf(name);
  const s = stem(name);

  // 1. Tests first — a test file under app/ is a test, not a page.
  if (isTestPath(path)) {
    return { path, category: "test", role: `Test: ${pretty(s)}` };
  }

  // 2. Exact known basenames.
  if (EXACT[lower]) {
    const [category, role] = EXACT[lower];
    return { path, category, role };
  }
  if (lower.startsWith("readme")) return { path, category: "docs", role: "Project readme" };
  if (lower.startsWith("changelog")) return { path, category: "docs", role: "Changelog" };
  if (lower.startsWith("contributing")) return { path, category: "docs", role: "Contribution guide" };
  if (lower === "claude.md" || lower === "agents.md" || lower === "gemini.md")
    return { path, category: "docs", role: "Agent guide" };

  // 3. Config-by-name (covers *.config.*, tsconfig*, .eslintrc*, etc.).
  if (lower.startsWith("tsconfig")) return { path, category: "config", role: "TypeScript config" };
  if (lower.startsWith("next.config")) return { path, category: "config", role: "Next.js config" };
  if (lower.startsWith("vite.config") || lower.startsWith("vitest.config"))
    return { path, category: "config", role: "Build/test config" };
  if (lower.startsWith("tailwind.config")) return { path, category: "config", role: "Tailwind config" };
  if (lower.startsWith("postcss.config")) return { path, category: "config", role: "PostCSS config" };
  if (lower.startsWith("eslint") || lower.startsWith(".eslintrc"))
    return { path, category: "config", role: "ESLint config" };
  if (lower.startsWith("prettier") || lower.startsWith(".prettierrc"))
    return { path, category: "config", role: "Prettier config" };
  if (lower.endsWith(".config.js") || lower.endsWith(".config.ts") || lower.endsWith(".config.mjs"))
    return { path, category: "config", role: `${pretty(stem(s))} config` };

  // 4. First-segment conventions.
  const segs = path.split("/").filter(Boolean);
  const first = segs[0]?.toLowerCase();

  if (first === "app" || first === "pages" || first === "src" && segs[1]?.toLowerCase() === "app") {
    if (lower.startsWith("page.")) {
      const route = segs.slice(first === "app" ? 1 : 1, -1).join("/") || "home";
      return { path, category: "ui", role: `Page route (/${route === "home" ? "" : route})` };
    }
    if (lower.startsWith("layout.")) return { path, category: "ui", role: "Layout" };
    if (lower.startsWith("route.")) return { path, category: "logic", role: "API route" };
    if (lower.startsWith("loading.")) return { path, category: "ui", role: "Loading UI" };
    if (lower.startsWith("error.")) return { path, category: "ui", role: "Error UI" };
    if (lower.startsWith("not-found.")) return { path, category: "ui", role: "404 UI" };
    if (lower.startsWith("middleware.")) return { path, category: "logic", role: "Middleware" };
    if (lower.endsWith(".css") || lower.endsWith(".scss"))
      return { path, category: "style", role: lower.includes("global") ? "Global styles" : "Stylesheet" };
    if (ext === "tsx" || ext === "jsx") return { path, category: "ui", role: `App component (${pretty(s)})` };
  }

  if (first === "components" || first === "component" || (first === "src" && segs[1]?.toLowerCase() === "components")) {
    if (ext === "tsx" || ext === "jsx") return { path, category: "ui", role: `UI component (${pretty(s)})` };
  }

  if (first === "engine") {
    return { path, category: "engine", role: `Engine: ${pretty(s)}` };
  }

  if (first === "hooks" || (first === "src" && segs[1]?.toLowerCase() === "hooks")) {
    return { path, category: "logic", role: `React hook (${pretty(s)})` };
  }

  if (first === "lib" || first === "utils" || first === "util" || (first === "src" && (segs[1]?.toLowerCase() === "lib" || segs[1]?.toLowerCase() === "utils"))) {
    if (lower === "types.ts" || lower === "types.d.ts" || lower === "types.tsx")
      return { path, category: "logic", role: "Type definitions" };
    if (/^use[-A-Z]/.test(s)) return { path, category: "logic", role: `React hook (${pretty(s)})` };
    if (lower.includes("worker")) return { path, category: "logic", role: `Web Worker (${pretty(s)})` };
    return { path, category: "logic", role: `Library module (${pretty(s)})` };
  }

  if (first === "public" || first === "static" || first === "assets" || first === "asset") {
    if (ext === "json") return { path, category: "data", role: "Bundled data" };
    return { path, category: "asset", role: "Static asset" };
  }

  if (first === "docs" || first === "doc") return { path, category: "docs", role: "Documentation" };
  if (first === "scripts" || first === "script" || first === "bin")
    return { path, category: "build", role: `Build script (${pretty(s)})` };
  if (first === "styles" || first === "css") return { path, category: "style", role: "Stylesheet" };
  if (first === "api" || first === "server") return { path, category: "logic", role: "API endpoint" };

  // 5. Worker / hook / types anywhere.
  if (lower.includes(".worker.") || s.toLowerCase().endsWith("worker"))
    return { path, category: "logic", role: `Web Worker (${pretty(s)})` };
  if (lower === "types.ts" || lower === "types.d.ts")
    return { path, category: "logic", role: "Type definitions" };

  // 6. Extension fallback.
  return roleByExt(path, ext, s);
}

function roleByExt(path: string, ext: string, s: string): FileRole {
  switch (ext) {
    case "tsx":
    case "jsx":
      return { path, category: "ui", role: `Component (${pretty(s)})` };
    case "ts":
    case "js":
    case "mjs":
    case "cjs":
      return { path, category: "logic", role: `Module (${pretty(s)})` };
    case "css":
    case "scss":
    case "sass":
    case "less":
      return { path, category: "style", role: "Stylesheet" };
    case "md":
    case "mdx":
    case "txt":
    case "rst":
      return { path, category: "docs", role: "Documentation" };
    case "json":
    case "yml":
    case "yaml":
    case "toml":
    case "ini":
    case "env":
      return { path, category: "config", role: "Configuration / data" };
    case "py":
      return { path, category: "logic", role: `Python source (${pretty(s)})` };
    case "rs":
      return { path, category: "logic", role: `Rust source (${pretty(s)})` };
    case "go":
      return { path, category: "logic", role: `Go source (${pretty(s)})` };
    case "java":
    case "kt":
    case "rb":
    case "php":
    case "swift":
    case "c":
    case "cpp":
    case "h":
      return { path, category: "logic", role: `Source (${pretty(s)})` };
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
    case "ico":
    case "avif":
    case "mp4":
    case "webm":
    case "woff":
    case "woff2":
    case "ttf":
      return { path, category: "asset", role: "Asset" };
    case "sql":
      return { path, category: "data", role: "SQL / schema" };
    case "html":
      return { path, category: "ui", role: "HTML page" };
    default:
      return { path, category: "other", role: ext ? `.${ext} file` : "File" };
  }
}
