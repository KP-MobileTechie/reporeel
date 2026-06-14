// ---------------------------------------------------------------------------
// insights/techStack.ts — detect the languages, frameworks, libraries and
// tooling a repo uses, purely from the set of file paths it contains plus a
// language histogram. Marker files (next.config.*, Cargo.toml, …) are strong
// signals; extensions back them up. Deterministic and ordered: languages by
// usage first, then frameworks, libraries, tooling.
// ---------------------------------------------------------------------------

import type { TechItem } from "./types";

const LANG_LABEL: Record<string, string> = {
  ts: "TypeScript",
  js: "JavaScript",
  py: "Python",
  rs: "Rust",
  go: "Go",
  css: "CSS",
  html: "HTML",
  md: "Markdown",
};

interface Marker {
  /** Predicate over the lowercased basename of a path. */
  match: (base: string, path: string) => boolean;
  item: Omit<TechItem, "evidence">;
}

const MARKERS: Marker[] = [
  { match: (b) => b.startsWith("next.config"), item: { name: "Next.js", kind: "framework" } },
  { match: (b) => b === "remix.config.js" || b === "remix.config.ts", item: { name: "Remix", kind: "framework" } },
  { match: (b) => b === "astro.config.mjs" || b === "astro.config.ts", item: { name: "Astro", kind: "framework" } },
  { match: (b) => b === "svelte.config.js", item: { name: "Svelte", kind: "framework" } },
  { match: (b) => b === "nuxt.config.ts" || b === "nuxt.config.js", item: { name: "Nuxt", kind: "framework" } },
  { match: (b) => b === "vue.config.js", item: { name: "Vue", kind: "framework" } },
  { match: (b) => b === "angular.json", item: { name: "Angular", kind: "framework" } },
  { match: (b) => b === "gatsby-config.js", item: { name: "Gatsby", kind: "framework" } },
  { match: (b) => b === "vite.config.ts" || b === "vite.config.js", item: { name: "Vite", kind: "tooling" } },
  { match: (b) => b.startsWith("vitest.config"), item: { name: "Vitest", kind: "tooling" } },
  { match: (b) => b.startsWith("jest.config") || b === "jest.setup.js", item: { name: "Jest", kind: "tooling" } },
  { match: (b) => b === "playwright.config.ts" || b === "playwright.config.js", item: { name: "Playwright", kind: "tooling" } },
  { match: (b) => b === "cypress.config.ts" || b === "cypress.config.js", item: { name: "Cypress", kind: "tooling" } },
  { match: (b) => b.startsWith("tailwind.config") || b.startsWith("postcss.config"), item: { name: "Tailwind CSS", kind: "library" } },
  { match: (b) => b.startsWith("eslint") || b.startsWith(".eslintrc"), item: { name: "ESLint", kind: "tooling" } },
  { match: (b) => b.startsWith("prettier") || b.startsWith(".prettierrc"), item: { name: "Prettier", kind: "tooling" } },
  { match: (b) => b.startsWith("tsconfig"), item: { name: "TypeScript", kind: "language" } },
  { match: (b) => b === "dockerfile" || b === "docker-compose.yml", item: { name: "Docker", kind: "tooling" } },
  { match: (b) => b === "cargo.toml", item: { name: "Rust", kind: "language" } },
  { match: (b) => b === "go.mod", item: { name: "Go", kind: "language" } },
  { match: (b) => b === "pyproject.toml" || b === "requirements.txt" || b === "pipfile", item: { name: "Python", kind: "language" } },
  { match: (b) => b === "gemfile", item: { name: "Ruby", kind: "language" } },
  { match: (b) => b === "go.sum", item: { name: "Go", kind: "language" } },
  { match: (b) => b === "vercel.json", item: { name: "Vercel", kind: "tooling" } },
  { match: (b, p) => p.includes("/.github/workflows/"), item: { name: "GitHub Actions", kind: "tooling" } },
];

function baseName(path: string): string {
  return (path.split("/").pop() ?? path).toLowerCase();
}

/**
 * Detect the tech stack from a list of file paths and a language histogram
 * (lang key → file count, as produced by langOf). Returns a de-duplicated,
 * ordered list: languages (by usage) → frameworks → libraries → tooling.
 */
export function detectTechStack(
  paths: Iterable<string>,
  langCounts: { lang: string; count: number }[],
): TechItem[] {
  const found = new Map<string, TechItem>();

  // Languages from the histogram, in usage order (langCounts is count-desc), so
  // the FIRST language is the most-used one — what the headline should name.
  for (const { lang, count } of langCounts) {
    const label = LANG_LABEL[lang];
    if (label) found.set(label, { name: label, kind: "language", evidence: `${count} file${count === 1 ? "" : "s"}` });
  }

  // Marker files.
  for (const path of paths) {
    const base = baseName(path);
    for (const m of MARKERS) {
      if (m.match(base, path)) {
        const ev = m.item.kind === "language" ? `marker: ${base}` : `${base}`;
        // First evidence wins, but never downgrade an existing language entry.
        if (!found.has(m.item.name)) {
          found.set(m.item.name, { ...m.item, evidence: ev });
        }
      }
    }
  }

  // React: any .tsx/.jsx present.
  for (const path of paths) {
    if (/\.(tsx|jsx)$/i.test(path)) {
      if (!found.has("React")) found.set("React", { name: "React", kind: "library", evidence: ".tsx components" });
      break;
    }
  }

  // Languages keep their usage order (insertion order above); frameworks,
  // libraries and tooling follow, alphabetical within each kind.
  const all = [...found.values()];
  const languages = all.filter((t) => t.kind === "language");
  const rest = all
    .filter((t) => t.kind !== "language")
    .sort((a, b) => {
      const order: Record<TechItem["kind"], number> = { language: 0, framework: 1, library: 2, tooling: 3 };
      return order[a.kind] - order[b.kind] || a.name.localeCompare(b.name);
    });
  return [...languages, ...rest];
}
