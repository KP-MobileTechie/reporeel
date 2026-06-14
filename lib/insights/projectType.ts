// ---------------------------------------------------------------------------
// insights/projectType.ts — classify WHAT KIND of project this is in product
// terms (a web app, a library, a CLI, a game, a backend service, …), distinct
// from the tech stack ("what it's built with"). Rule-based over file paths,
// directory shape and detected stack; ordered most-specific-first, with a
// dominant-category fallback so every repo gets a sensible answer.
// ---------------------------------------------------------------------------

import type { FileCategory, ModuleInsight, ProjectType, TechItem } from "./types";

export function detectProjectType(
  paths: string[],
  techStack: TechItem[],
  modules: ModuleInsight[],
): ProjectType {
  const lower = paths.map((p) => p.toLowerCase());
  const techNames = new Set(techStack.map((t) => t.name));
  const dirs = new Set(modules.map((m) => m.dir.toLowerCase()));
  const has = (re: RegExp) => lower.some((p) => re.test(p));
  const tech = (name: string) => techNames.has(name);
  const framework = techStack.find((t) => t.kind === "framework")?.name;

  // Mobile
  if (tech("Expo") || has(/(^|\/)(ios|android)\//) || has(/app\.json$/) || has(/\.(swift|kt)$/)) {
    return mk("Mobile app", `A mobile app${framework ? ` built with ${framework}` : ""}.`, "high", ["native mobile files / Expo"]);
  }
  // Data / ML
  if (has(/\.ipynb$/) || has(/(^|\/)(notebooks?|models?|datasets?)\//) || has(/(requirements\.txt|environment\.yml)$/)) {
    return mk("Data / ML project", "A data science or machine-learning project.", "medium", ["notebooks / model / dataset files"]);
  }
  // Game
  if (has(/(^|\/)(game|games|player|board|level|score|entity|entities)/) && (has(/canvas|webgl|phaser|three/) || dirs.has("engine"))) {
    return mk("Game", `An interactive game${framework ? ` (${framework})` : ""}.`, "medium", ["game/engine files"]);
  }
  // CLI
  if (has(/(^|\/)(bin|cli)\//) || tech("Commander") || has(/#!\/usr\/bin\/env node/)) {
    return mk("Command-line tool", "A command-line tool.", "medium", ["bin/ or cli/ entry"]);
  }
  // Documentation site
  if ((tech("Astro") || has(/docusaurus|mkdocs/)) || (dirs.has("docs") && dominantCategory(modules) === "docs")) {
    return mk("Documentation site", "A documentation or content site.", "medium", ["docs-heavy / static-site generator"]);
  }
  // Backend / API service (no UI app dir but has routes/controllers/server)
  const hasUiApp = dirs.has("app") || dirs.has("pages") || has(/(^|\/)app\//);
  if (!hasUiApp && (has(/(^|\/)(routes?|controllers?|handlers?|server|api)\//) || tech("Express") || tech("Fastify") || tech("NestJS"))) {
    return mk("Backend / API service", "A server-side or API service.", "medium", ["routes / server code, no UI app"]);
  }
  // Web application
  if (hasUiApp && (tech("Next.js") || tech("React") || tech("Vue") || tech("Svelte") || tech("Remix") || tech("Nuxt") || tech("Angular"))) {
    return mk("Web application", `A ${framework ?? "web"} application.`, "high", ["app/ or pages/ with a web framework"]);
  }
  // Library / package
  if (has(/package\.json$/) && (dirs.has("lib") || dirs.has("src")) && !hasUiApp) {
    return mk("Library / package", "A reusable library or package.", "medium", ["lib/src code, published as a package, no app UI"]);
  }

  // Fallback by what the code mostly is.
  const dom = dominantCategory(modules);
  if (dom === "ui") return mk("Web / UI project", "A user-interface project.", "low", ["mostly UI code"]);
  if (dom === "engine") return mk("Engine / graphics project", "A rendering or simulation engine.", "low", ["mostly engine code"]);
  if (dom === "logic") return mk("Library / tool", "A code library or tool.", "low", ["mostly application logic"]);
  return mk("Software project", "A software project.", "low", ["no strong product signal"]);
}

function mk(type: string, tagline: string, confidence: ProjectType["confidence"], signals: string[]): ProjectType {
  return { type, tagline, confidence, signals };
}

function dominantCategory(modules: ModuleInsight[]): FileCategory {
  const counts = new Map<FileCategory, number>();
  for (const m of modules) counts.set(m.dominantCategory, (counts.get(m.dominantCategory) ?? 0) + m.liveCount);
  let best: FileCategory = "other";
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}
