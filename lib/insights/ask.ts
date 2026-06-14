// ---------------------------------------------------------------------------
// insights/ask.ts — "ask the repo." A deterministic question resolver over the
// ProjectBrief: it reads a plain-language question, detects intent from
// keywords, and answers from the structured brief (files, roles, contributors,
// health, eras, …). No LLM, no network — same question always yields the same
// answer. Anything it can't classify falls back to a keyword search across the
// file directory, then to a helpful suggestion list.
// ---------------------------------------------------------------------------

import type { FileCategory, ProjectBrief } from "./types";

export interface AnswerFile {
  path: string;
  role: string;
  category: FileCategory;
}

export interface Answer {
  /** Stable intent label (for tests and analytics). */
  intent: string;
  title: string;
  text: string;
  files?: AnswerFile[];
  bullets?: string[];
}

export const EXAMPLE_QUESTIONS = [
  "Where are the tests?",
  "What's the biggest file?",
  "Who owns the code?",
  "Where do I start?",
  "How healthy is it?",
  "What's it built with?",
];

const STOP = new Set([
  "the", "a", "an", "is", "are", "of", "in", "to", "for", "what", "whats", "where", "who",
  "how", "do", "does", "i", "this", "repo", "project", "code", "codebase", "file", "files",
  "me", "show", "tell", "about", "and", "with", "which", "that", "there", "it", "its", "any",
]);

function allFiles(brief: ProjectBrief): AnswerFile[] {
  return brief.modules.flatMap((m) => m.files.map((f) => ({ path: f.path, role: f.role, category: f.category })));
}

export function answerQuery(brief: ProjectBrief, query: string): Answer {
  const q = query.trim().toLowerCase();
  if (!q) {
    return { intent: "empty", title: "Ask the repo", text: "Ask anything about this codebase.", bullets: EXAMPLE_QUESTIONS };
  }

  const has = (...words: string[]) => words.some((w) => q.includes(w));
  const files = allFiles(brief);

  // Health & risk (most specific first).
  if (has("health", "healthy", "grade", "quality", "well maintained")) {
    const h = brief.health;
    return {
      intent: "health",
      title: "Project health",
      text: `${h.score}/100 (grade ${h.grade}). ${h.summary}`,
      bullets: h.factors.map((f) => `${f.name}: ${f.score}/${f.max} — ${f.note}`),
    };
  }
  if (has("bus factor", "key person", "key-person", "at risk", "risky", "risk")) {
    const r = brief.risk;
    return { intent: "risk", title: "Risk & ownership", text: `Bus factor ${r.busFactor}. ${r.busFactorNote}`, bullets: r.notes };
  }
  if (has("hotspot", "complex", "complicated", "fragile", "hardest", "messy")) {
    const r = brief.risk;
    return {
      intent: "hotspots",
      title: "Maintenance hotspots",
      text: r.hotspots.length ? "Files with the most churn in the fewest hands:" : "No hotspots detected.",
      files: r.hotspots.map((h) => ({ path: h.path, role: h.note, category: "logic" as FileCategory })),
    };
  }
  if (has("test", "tested", "coverage", "spec")) {
    const t = files.filter((f) => f.category === "test");
    return {
      intent: "tests",
      title: "Tests",
      text: t.length ? `${t.length} test file${t.length === 1 ? "" : "s"} in this repo.` : "No test files found.",
      files: t.slice(0, 20),
    };
  }
  if (has("biggest", "largest", "most changed", "most active", "most important", "matter", "key file", "churn", "important", "central")) {
    return {
      intent: "keyfiles",
      title: "Files that matter most",
      text: "Ranked by churn, edit frequency and how central they are:",
      files: brief.keyFiles.map((k) => ({ path: k.path, role: k.role, category: k.category })),
    };
  }
  if (has("who", "owns", "owner", "author", "contributor", "maintainer", "wrote")) {
    const ownerDir = brief.risk.ownership.find((o) => q.includes(o.dir.toLowerCase()));
    if (ownerDir) {
      return {
        intent: "ownership",
        title: `Owner of ${ownerDir.dir}`,
        text: `${ownerDir.owner} contributed ${ownerDir.sharePct}% of the changes in ${ownerDir.dir}.`,
      };
    }
    return {
      intent: "contributors",
      title: "Contributors",
      text: brief.contributors.length
        ? `${brief.stats.contributors} contributor${brief.stats.contributors === 1 ? "" : "s"}.`
        : "No contributors found.",
      bullets: brief.contributors.map((c) => `${c.author} — ${c.commits} commits, focused on ${c.focus}`),
    };
  }
  if (has("good first", "first file", "contribut", "easy file", "first change", "where should i start contributing")) {
    return {
      intent: "firstFiles",
      title: "Good first files",
      text: brief.firstFiles.length ? "Approachable, low-risk places to make a first change:" : "No obvious starter files found.",
      files: brief.firstFiles.map((f) => ({ path: f.path, role: f.why, category: "logic" as FileCategory })),
    };
  }
  if (has("start", "begin", "onboard", "first", "new to", "get up to speed", "learn", "ramp")) {
    return {
      intent: "onboarding",
      title: "Start here",
      text: "Read these in order:",
      files: brief.readingPath.map((s) => ({ path: s.path, role: s.why, category: "logic" as FileCategory })),
    };
  }
  if (has("built with", "written in", "stack", "language", "framework", "tech", "technolog")) {
    return {
      intent: "stack",
      title: "Tech stack",
      text: brief.techStack.map((t) => t.name).join(", ") + ".",
      bullets: brief.techStack.map((t) => `${t.name} — ${t.kind} (${t.evidence})`),
    };
  }
  if (has("entry", "entry point", "starts", "bootstrap", "main file")) {
    const entry = files.filter((f) => /^(page|index|main|app)\.[jt]sx?$/i.test(f.path.split("/").pop() ?? ""));
    return {
      intent: "entry",
      title: "Entry points",
      text: entry.length ? "Where the app starts:" : "No obvious entry point found.",
      files: entry.slice(0, 10),
    };
  }
  if (has("types", "type definition", "model", "schema", "interface", "data shape")) {
    const t = files.filter((f) => /type/i.test(f.path) || /type/i.test(f.role));
    return {
      intent: "types",
      title: "Types & data shapes",
      text: t.length ? "Core data definitions:" : "No dedicated type files found.",
      files: t.slice(0, 10),
    };
  }
  if (has("config", "configuration", "setup", "build", "tooling")) {
    const c = files.filter((f) => f.category === "config" || f.category === "build");
    return { intent: "config", title: "Configuration", text: "Config and tooling files:", files: c.slice(0, 15) };
  }
  if (has("recent", "latest", "shipped", "highlight", "new feature", "newest", "what changed", "lately")) {
    return {
      intent: "highlights",
      title: "Recent highlights",
      text: brief.activity.highlights.length ? "Notable recent changes:" : "No notable recent changes.",
      bullets: brief.activity.highlights.map((h) => `[${h.type}] ${h.message} (${h.author})`),
    };
  }
  if (has("coupl", "change together", "related", "depend", "connected")) {
    return {
      intent: "coupling",
      title: "Files that change together",
      text: brief.coupling.length ? "These tend to move in the same commit:" : "No strong coupling detected.",
      bullets: brief.coupling.map((c) => `${c.a} <-> ${c.b} (${Math.round(c.score * 100)}%)`),
    };
  }
  if (has("release", "version", "changelog", "semver", "shipped version")) {
    return {
      intent: "releases",
      title: "Releases",
      text: brief.releases.length ? "Detected releases / version bumps:" : "No releases detected in the history.",
      bullets: brief.releases.slice().reverse().map((r) => `${r.version ?? "release"} — ${r.message} (${r.author})`),
    };
  }
  if (has("convention", "casing", "naming", "code style", "house style", "monorepo", "dockerized", "has ci", "ci setup")) {
    const c = brief.conventions;
    return {
      intent: "conventions",
      title: "Conventions",
      text: c.signals.length ? c.signals.join(", ") + "." : "No strong conventions detected.",
      bullets: [`Naming: ${c.casing}`, `CI: ${c.hasCI ? "yes" : "no"}`, `Docker: ${c.hasDocker ? "yes" : "no"}`, `Monorepo: ${c.monorepo ? "yes" : "no"}`],
    };
  }
  if (has("vocab", "glossary", "terms", "jargon", "terminology", "domain words")) {
    return {
      intent: "glossary",
      title: "Vocabulary",
      text: brief.glossary.length ? "Terms that recur across the codebase:" : "No recurring domain terms found.",
      bullets: brief.glossary.map((g) => `${g.term} (${g.count} files)`),
    };
  }
  if (has("moment", "notable", "rewrite", "cleanup", "milestone", "big change", "turning point")) {
    return {
      intent: "events",
      title: "Notable moments",
      text: brief.events.length ? "Structurally significant moments:" : "No standout moments detected.",
      bullets: brief.events.map((e) => `[${e.kind}] ${e.title} — ${e.detail}`),
    };
  }
  if (has("busiest", "what day", "what time", "when do", "peak", "most active day", "work rhythm")) {
    const m = brief.metrics;
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const argmax = (a: number[]) => a.reduce((bi, v, i, arr) => (v > arr[bi] ? i : bi), 0);
    return {
      intent: "when",
      title: "When work happens (UTC)",
      text: `Busiest day is ${days[argmax(m.weekday)]}; peak hour is ${argmax(m.hour)}:00 UTC.`,
    };
  }
  if (has("how many", "count", "number of", "how big", "size")) {
    const s = brief.stats;
    return {
      intent: "stats",
      title: "By the numbers",
      text: `${s.totalCommits} commits, ${s.filesAlive} current files, ${s.contributors} contributor${s.contributors === 1 ? "" : "s"}.`,
      bullets: [
        `Commits: ${s.totalCommits}`,
        `Current files: ${s.filesAlive}`,
        `Contributors: ${s.contributors}`,
        `Languages: ${s.languages.slice(0, 5).map((l) => l.lang).join(", ")}`,
      ],
    };
  }
  if (has("era", "chapter", "history", "timeline", "phase", "evolv", "over time")) {
    return { intent: "eras", title: "The story in chapters", text: "How the project unfolded:", bullets: brief.eras.map((e) => `${e.label}: ${e.summary}`) };
  }
  if (has("module", "folder", "structure", "architecture", "organiz", "directory", "layout", "map")) {
    return { intent: "modules", title: "Map of the codebase", text: `${brief.modules.length} top-level areas:`, bullets: brief.modules.map((m) => `${m.dir} — ${m.purpose}`) };
  }

  // Fallback: keyword search across the file directory.
  const tokens = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
  if (tokens.length) {
    const matched = files.filter((f) => tokens.some((t) => f.path.toLowerCase().includes(t) || f.role.toLowerCase().includes(t)));
    if (matched.length) {
      return {
        intent: "search",
        title: `Files matching “${query.trim()}”`,
        text: `${matched.length} match${matched.length === 1 ? "" : "es"}:`,
        files: matched.slice(0, 20),
      };
    }
  }

  return {
    intent: "unknown",
    title: "Not sure about that one",
    text: "Try asking about tests, the biggest files, who owns the code, where to start, or how healthy it is.",
    bullets: EXAMPLE_QUESTIONS,
  };
}
