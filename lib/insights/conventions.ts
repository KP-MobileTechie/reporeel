// ---------------------------------------------------------------------------
// insights/conventions.ts — project conventions and infrastructure signals
// inferred from file paths alone: the dominant file-naming casing, and whether
// the repo has CI, containerization, a monorepo/workspace layout, and tests.
// Pure and deterministic; helps a newcomer match house style fast.
// ---------------------------------------------------------------------------

import type { Conventions } from "./types";
import { isTestPath } from "./fileRoles";

function stem(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.indexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function casingOf(name: string): "kebab-case" | "snake_case" | "PascalCase" | "camelCase" | "other" {
  if (!name || !/[a-zA-Z]/.test(name)) return "other";
  if (name.includes("-")) return "kebab-case";
  if (name.includes("_")) return "snake_case";
  if (/^[A-Z]/.test(name) && /[a-z]/.test(name)) return "PascalCase";
  if (/^[a-z]/.test(name) && /[A-Z]/.test(name)) return "camelCase";
  return "other";
}

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|rb|php|swift|c|cpp|h)$/i;

export function detectConventions(paths: string[]): Conventions {
  const counts = new Map<string, number>();
  let hasCI = false;
  let hasDocker = false;
  let monorepo = false;
  let hasTests = false;

  for (const p of paths) {
    const lower = p.toLowerCase();
    if (lower.includes(".github/workflows/") || lower.includes(".gitlab-ci") || lower.includes(".circleci/") || lower.includes(".travis.yml")) hasCI = true;
    const base = lower.split("/").pop() ?? "";
    if (base === "dockerfile" || base === "docker-compose.yml" || base === "docker-compose.yaml") hasDocker = true;
    if (/^(packages|apps)\//.test(p)) monorepo = true;
    if (isTestPath(p)) hasTests = true;
    if (CODE_EXT.test(p)) {
      const c = casingOf(stem(p));
      if (c !== "other") counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }

  let casing = "mixed";
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length) {
    const total = ranked.reduce((s, [, n]) => s + n, 0);
    // Call it consistent only if the top style is a clear majority.
    if (ranked[0][1] / total >= 0.6) casing = ranked[0][0];
  }

  const signals: string[] = [];
  if (hasCI) signals.push("CI configured");
  if (hasDocker) signals.push("Dockerized");
  if (monorepo) signals.push("Monorepo / workspaces");
  if (hasTests) signals.push("Has tests");
  if (casing !== "mixed") signals.push(`${casing} file names`);

  return { casing, hasCI, hasDocker, monorepo, hasTests, signals };
}
