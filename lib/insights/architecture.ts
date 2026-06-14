// ---------------------------------------------------------------------------
// insights/architecture.ts — group files into top-level modules and describe
// each one's purpose. The map answers "what are the big pieces of this repo and
// what does each do" for someone who has never opened it.
// ---------------------------------------------------------------------------

import type { FileCategory, FileEntry, ModuleInsight } from "./types";
import type { FileAgg } from "./aggregate";
import { topDir } from "./aggregate";
import { roleOf } from "./fileRoles";

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

// Curated purpose lines for conventional directory names.
const DIR_PURPOSE: Record<string, string> = {
  app: "Application routes, layouts and pages",
  pages: "Page routes",
  src: "Application source",
  components: "Reusable UI components",
  lib: "Core application logic and utilities",
  engine: "The custom rendering / simulation engine",
  hooks: "Reusable React hooks",
  utils: "Shared utility helpers",
  tests: "Automated test suite",
  test: "Automated test suite",
  __tests__: "Automated test suite",
  public: "Static public assets",
  static: "Static assets",
  assets: "Static assets",
  scripts: "Build and maintenance scripts",
  docs: "Project documentation",
  styles: "Stylesheets and theming",
  api: "Backend / API endpoints",
  server: "Server-side code",
  "(root)": "Top-level project configuration and docs",
};

const CATEGORY_PHRASE: Record<FileCategory, string> = {
  ui: "user-interface code",
  logic: "application logic",
  engine: "engine code",
  test: "tests",
  config: "configuration",
  docs: "documentation",
  style: "styling",
  data: "bundled data",
  asset: "static assets",
  build: "build tooling",
  other: "assorted files",
};

function dominant<T>(items: T[], keyOf: (t: T) => string): string {
  const counts = new Map<string, number>();
  for (const it of items) {
    const k = keyOf(it);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = "";
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

/**
 * Build the module map from per-file aggregates. One entry per top-level
 * directory, sorted by file count descending. `keyFiles` lists the highest-
 * churn paths within each module.
 */
export function buildModules(files: Iterable<FileAgg>): ModuleInsight[] {
  const groups = new Map<string, FileAgg[]>();
  for (const f of files) {
    const d = topDir(f.path);
    let g = groups.get(d);
    if (!g) groups.set(d, (g = []));
    g.push(f);
  }

  const modules: ModuleInsight[] = [];
  for (const [dir, group] of groups) {
    const cats = group.map((f) => roleOf(f.path).category);
    const dominantCategory = dominant(cats.map((c) => ({ c })), (x) => x.c) as FileCategory;
    const sorted = [...group].sort((a, b) => b.churn - a.churn || a.path.localeCompare(b.path));
    const top = sorted.slice(0, 3).map((f) => f.path);

    // Full directory of the module's CURRENT files, each with its role, so a
    // newcomer can see exactly what every file is for. Dead (deleted/renamed-
    // away) files are dropped — they no longer exist to work on.
    const files: FileEntry[] = sorted
      .filter((f) => f.alive)
      .map((f) => {
        const r = roleOf(f.path);
        return {
          path: f.path,
          name: baseName(f.path),
          role: r.role,
          category: r.category,
          commits: f.commits,
          churn: f.churn,
          alive: f.alive,
        };
      });
    const liveCount = files.length;

    const base = DIR_PURPOSE[dir.toLowerCase()];
    const purpose = base
      ? `${base} (${liveCount} file${liveCount === 1 ? "" : "s"}, mostly ${CATEGORY_PHRASE[dominantCategory]}).`
      : `${liveCount} file${liveCount === 1 ? "" : "s"}, mostly ${CATEGORY_PHRASE[dominantCategory]}.`;

    modules.push({ dir, purpose, fileCount: group.length, liveCount, dominantCategory, keyFiles: top, files });
  }

  // Sort by current file count (what a newcomer will actually open), then name.
  modules.sort((a, b) => b.liveCount - a.liveCount || b.fileCount - a.fileCount || a.dir.localeCompare(b.dir));
  // Drop modules with no current files (fully deleted areas).
  return modules.filter((m) => m.liveCount > 0);
}
