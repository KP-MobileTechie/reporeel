// ---------------------------------------------------------------------------
// insights/brief.ts — assemble the full ProjectBrief from a CommitTimeline.
//
// This is the single entry point the UI and the exporter call. It runs one
// aggregation pass, then composes the headline, summary, tech stack, module
// map, key files, contributor roles, eras and narration. Pure and
// deterministic: identical input → identical brief.
// ---------------------------------------------------------------------------

import type { CommitTimeline } from "@/lib/types";
import type { ContributorRole, FileCategory, ProjectBrief } from "./types";
import { aggregate } from "./aggregate";
import { roleOf } from "./fileRoles";
import { detectTechStack } from "./techStack";
import { buildModules } from "./architecture";
import { rankKeyFiles } from "./keyFiles";
import { detectEras } from "./eras";
import { buildNarration } from "./narration";
import { buildReadingPath } from "./onboarding";
import { suggestFirstFiles } from "./firstFiles";
import { buildGlossary } from "./glossary";
import { analyzeRisk } from "./risk";
import { detectCoupling } from "./coupling";
import { analyzeActivity } from "./activity";
import { healthFromCommits, computeHealthTrend } from "./healthTrend";
import { detectProjectType } from "./projectType";
import { analyzeTeam } from "./team";
import { analyzeCulture } from "./culture";
import { detectEvents } from "./events";
import { computeMetrics } from "./metrics";
import { detectReleases } from "./release";
import { detectConventions } from "./conventions";

const DAY_MS = 86_400_000;

function plural(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? "" : "s"}`;
}

function spanLabel(days: number): string {
  if (days < 1) return "a single day";
  if (days < 14) return plural(Math.round(days), "day");
  if (days < 60) return plural(Math.round(days / 7), "week");
  if (days < 730) return plural(Math.round(days / 30), "month");
  return plural(Math.round((days / 365) * 10) / 10, "year").replace(".0 ", " ");
}

function buildContributors(
  authors: ReturnType<typeof aggregate>["authors"],
): ContributorRole[] {
  const rows = [...authors.values()].sort((a, b) => b.commits - a.commits);
  return rows.slice(0, 6).map((a) => {
    const areas = [...a.dirs.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map((e) => e[0])
      .filter((d) => d !== "(root)");
    const focus = areas.length ? areas.slice(0, 2).join(" and ") : "across the codebase";
    return { author: a.author, commits: a.commits, focus, areas };
  });
}

/** Build the coordinator brief for a repository. */
export function buildBrief(ct: CommitTimeline): ProjectBrief {
  const { commits, repo } = ct;
  const agg = aggregate(commits);

  const paths = [...agg.files.keys()];
  const techStack = detectTechStack(paths, agg.langCounts);
  const modules = buildModules(agg.files.values());
  const projectType = detectProjectType(paths, techStack, modules);
  const keyFiles = rankKeyFiles(agg.files.values(), 8);
  const contributors = buildContributors(agg.authors);

  const first = commits.length ? Math.min(...commits.map((c) => c.date)) : 0;
  const last = commits.length ? Math.max(...commits.map((c) => c.date)) : 0;
  const spanDays = (last - first) / DAY_MS;

  const eras = detectEras(commits, 5);
  const readingPath = buildReadingPath(keyFiles, modules);
  const risk = analyzeRisk(agg);
  // Coupling is only insightful between source files — pairing a README with a
  // config file just reflects the scaffolding commit. Restrict to code-ish files.
  const couplingCats = new Set<FileCategory>(["ui", "logic", "engine", "style", "data"]);
  const couplingPaths = new Set(
    [...agg.files.values()]
      .filter((f) => f.alive && couplingCats.has(roleOf(f.path).category))
      .map((f) => f.path),
  );
  const coupling = detectCoupling(commits, couplingPaths, 8);

  // ── Headline + summary ────────────────────────────────────────────────────
  const framework = techStack.find((t) => t.kind === "framework");
  const primaryLang = techStack.find((t) => t.kind === "language");
  const langPart = primaryLang ? primaryLang.name : "code";
  const kindPart = framework ? `${framework.name} project` : "project";
  const headline = `${repo.name} — a ${kindPart} in ${langPart}.`;

  const biggestModule = modules.find((m) => m.dir !== "(root)") ?? modules[0];
  const hotspot = keyFiles[0];
  const summaryParts: string[] = [];
  summaryParts.push(
    `${repo.name} is a ${framework ? framework.name + " " : ""}codebase of ${plural(
      agg.filesAlive,
      "live file",
    )} built over ${spanLabel(spanDays)} across ${plural(agg.authors.size, "contributor")}.`,
  );
  if (biggestModule) {
    summaryParts.push(`Its largest area is \`${biggestModule.dir}\` — ${lowerFirst(biggestModule.purpose)}`);
  }
  if (hotspot) {
    summaryParts.push(`The most active file is \`${hotspot.path}\` (${hotspot.role}).`);
  }
  const summary = summaryParts.join(" ");

  const narration = buildNarration(headline, eras, commits, first, last);

  // ── Health grade + trend ────────────────────────────────────────────────────
  const activity = analyzeActivity(commits);
  const health = healthFromCommits(commits);
  const healthTrend = computeHealthTrend(commits, eras);

  return {
    name: repo.name,
    source: repo.source,
    projectType,
    headline,
    summary,
    techStack,
    modules,
    keyFiles,
    readingPath,
    firstFiles: suggestFirstFiles(agg, modules, risk.hotspots, coupling, 5),
    glossary: buildGlossary([...agg.files.values()].filter((f) => f.alive).map((f) => f.path), 16),
    risk,
    coupling,
    contributors,
    eras,
    activity,
    culture: analyzeCulture(commits, eras),
    events: detectEvents(commits, 8),
    metrics: computeMetrics(commits, agg, eras),
    releases: detectReleases(commits, 20),
    conventions: detectConventions(paths),
    health,
    healthTrend,
    team: analyzeTeam(commits),
    narration,
    stats: {
      totalCommits: commits.length,
      totalFiles: agg.files.size,
      filesAlive: agg.filesAlive,
      spanDays,
      firstCommit: first,
      lastCommit: last,
      contributors: agg.authors.size,
      languages: agg.langCounts,
    },
  };
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}
