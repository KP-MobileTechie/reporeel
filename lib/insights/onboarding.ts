// ---------------------------------------------------------------------------
// insights/onboarding.ts — build the recommended reading order for someone who
// just cloned the repo. The path follows how an experienced developer actually
// orients themselves: read the project's own description, learn how to run it,
// find where it starts, learn its core data shapes, then read the few files
// everything else leans on. Each step says WHY it's next.
// ---------------------------------------------------------------------------

import type { KeyFile, ModuleInsight, ReadingStep, FileEntry } from "./types";

export function buildReadingPath(keyFiles: KeyFile[], modules: ModuleInsight[]): ReadingStep[] {
  const allFiles: FileEntry[] = modules.flatMap((m) => m.files);
  const find = (pred: (f: FileEntry) => boolean) => allFiles.find(pred);

  const steps: ReadingStep[] = [];
  const seen = new Set<string>();
  const add = (path: string | undefined, role: string, why: string) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    steps.push({ order: steps.length + 1, path, role, why });
  };

  const readme = find((f) => /^readme/i.test(f.name));
  if (readme) add(readme.path, readme.role, "The project's own front door: what it is and how to run it.");

  const pkg = find((f) => f.name.toLowerCase() === "package.json");
  if (pkg) add(pkg.path, pkg.role, "Dependencies and the scripts that build, test and run it.");

  const entry =
    find((f) => /^(page|index|main|app)\.[jt]sx?$/i.test(f.name)) ??
    allFiles.find((f) => f.category === "ui");
  if (entry) add(entry.path, entry.role, "The entry point where the app starts.");

  const types = find((f) => /^types?\.(d\.ts|tsx?|ts)$/i.test(f.name));
  if (types) add(types.path, types.role, "The core data shapes everything else is built around.");

  // Fill out with the most central source files not already covered.
  for (const k of keyFiles) {
    if (steps.length >= 7) break;
    if (k.category === "config" || k.category === "docs" || k.category === "asset") continue;
    add(k.path, k.role, `A central file: ${k.reason}.`);
  }

  return steps;
}
