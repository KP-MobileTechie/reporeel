// ---------------------------------------------------------------------------
// insights/types.ts — the shape of the "AI Coordinator" project brief.
//
// The coordinator is a DETERMINISTIC, client-side code-intelligence layer: it
// reads the same CommitTimeline the galaxy is built from and infers what the
// project IS, what each module/file DOES, who built what, and how the work
// unfolded over time. No network, no LLM, no cost — same repo always yields the
// same brief, so it works on local repos that never leave the browser.
// ---------------------------------------------------------------------------

import type { Source } from "@/lib/types";

/** Coarse purpose bucket for a file, used for color dots and module summaries. */
export type FileCategory =
  | "ui"
  | "logic"
  | "engine"
  | "test"
  | "config"
  | "docs"
  | "style"
  | "data"
  | "asset"
  | "build"
  | "other";

/** A single file's inferred identity. */
export interface FileRole {
  path: string;
  category: FileCategory;
  /** Human label, e.g. "Rendering engine", "UI component (ExportModal)". */
  role: string;
}

/** A single current file in the project directory, with what it's for. */
export interface FileEntry {
  path: string;
  /** Basename for compact display. */
  name: string;
  role: string;
  category: FileCategory;
  commits: number;
  churn: number;
  alive: boolean;
}

/** One top-level area of the codebase. */
export interface ModuleInsight {
  /** Top-level directory, or "(root)" for files at the repo root. */
  dir: string;
  /** Inferred one-line purpose of the module. */
  purpose: string;
  /** Distinct files ever seen in this module. */
  fileCount: number;
  /** Files still present at the end of history. */
  liveCount: number;
  dominantCategory: FileCategory;
  /** A few representative file paths (highest-churn first). */
  keyFiles: string[];
  /** Every current file in the module with its role, highest-churn first. */
  files: FileEntry[];
}

/** A file that matters, with the reason it ranked. */
export interface KeyFile {
  path: string;
  role: string;
  category: FileCategory;
  /** Total absolute churn (sum of abs(delta)) across history. */
  churn: number;
  /** Number of commits that touched it. */
  commits: number;
  /** Importance score (relative; higher = more central). */
  score: number;
  /** Why it ranked, e.g. "central entry point · 42 commits · high churn". */
  reason: string;
  alive: boolean;
}

/** A detected piece of the stack. */
export interface TechItem {
  name: string;
  kind: "language" | "framework" | "library" | "tooling";
  /** What in the repo proved it (a marker file or extension). */
  evidence: string;
}

/** A contiguous phase of the project's history. */
export interface Era {
  index: number;
  t0: number;
  t1: number;
  /** Short title, e.g. "Foundation", "Engine build-out". */
  label: string;
  /** One or two sentences describing what happened. */
  summary: string;
  commitCount: number;
  /** Directories that saw the most churn in this era. */
  topDirs: string[];
  topAuthors: string[];
}

/** What a contributor focused on. */
export interface ContributorRole {
  author: string;
  commits: number;
  /** Inferred focus sentence, e.g. "engine and rendering". */
  focus: string;
  /** Top directories they touched. */
  areas: string[];
}

/** A time-keyed caption shown live and burned into the exported video. */
export interface NarrationBeat {
  /** Epoch ms; the beat is active for all t >= this until the next beat. */
  t: number;
  kind: "intro" | "era" | "milestone" | "event" | "outro";
  text: string;
}

/** Headline statistics about the repo. */
export interface BriefStats {
  totalCommits: number;
  /** Distinct files ever seen. */
  totalFiles: number;
  /** Files still present at the end of history. */
  filesAlive: number;
  spanDays: number;
  firstCommit: number;
  lastCommit: number;
  contributors: number;
  /** Languages by file count, descending. */
  languages: { lang: string; count: number }[];
}

/** One step in the recommended reading order for a newcomer. */
export interface ReadingStep {
  order: number;
  path: string;
  role: string;
  /** Why read this now. */
  why: string;
}

/** Module dependency graph derived from import statements (local mode). */
export interface DepGraph {
  /** False when no source contents were available (e.g. demo/GitHub mode). */
  available: boolean;
  nodeCount: number;
  edgeCount: number;
  /** Files the most other files import (the core). */
  mostDependedOn: { path: string; count: number }[];
  /** Files that import the most others (the most entangled). */
  mostDependencies: { path: string; count: number }[];
  /** Files with no imports in or out. */
  orphans: string[];
  /** Import cycles (each a path of files, last === first). */
  cycles: string[][];
  /** Directed edges [from, to] for the graph view. */
  edges: [string, string][];
}

/** A recurring domain term mined from file names. */
export interface GlossaryTerm {
  term: string;
  count: number;
}

/** An approachable file for a newcomer's first contribution. */
export interface FirstFile {
  path: string;
  role: string;
  why: string;
}

/** Who owns a folder, by share of the churn within it. */
export interface OwnershipEntry {
  dir: string;
  owner: string;
  sharePct: number;
}

/** A file flagged as a maintenance risk (high churn, few maintainers). */
export interface RiskFile {
  path: string;
  role: string;
  churn: number;
  authors: number;
  note: string;
}

/** Project-health read aimed at managers and leads. */
export interface RiskAnalysis {
  /** People who together touched over half the commits. */
  busFactor: number;
  busFactorNote: string;
  /** The single biggest committer and their share. */
  keyPerson: { author: string; sharePct: number } | null;
  ownership: OwnershipEntry[];
  hotspots: RiskFile[];
  /** Live code untouched for the older portion of history (possibly neglected). */
  stale: RiskFile[];
  /** Plain-language findings. */
  notes: string[];
}

/** Two files that tend to change in the same commit. */
export interface CouplingPair {
  a: string;
  b: string;
  /** Number of commits that touched both. */
  together: number;
  /** together / min(individual touches) — 1 means they always move together. */
  score: number;
}

/** Share of commits of one work type (feat, fix, …). */
export interface CommitTypeSlice {
  type: string;
  count: number;
  pct: number;
}

/** A notable shipped change, for the "recent highlights" list. */
export interface Highlight {
  date: number;
  author: string;
  type: string;
  message: string;
}

export type MomentumTrend = "accelerating" | "steady" | "slowing" | "dormant";

/** The project's activity pulse: cadence, work mix, highlights, momentum. */
export interface ActivityInsight {
  /** Commit counts per equal time slice across the full history (sparkline). */
  buckets: number[];
  /** Work-type breakdown parsed from commit messages. */
  types: CommitTypeSlice[];
  /** Recent notable commits (features first). */
  highlights: Highlight[];
  momentum: { trend: MomentumTrend; recent: number; prior: number; note: string };
}

/** One scored dimension of project health. */
export interface HealthFactor {
  name: string;
  score: number;
  max: number;
  note: string;
}

/** A transparent 0-100 health grade with its factor breakdown. */
export interface HealthScore {
  score: number;
  grade: string;
  summary: string;
  factors: HealthFactor[];
}

/** What KIND of project this is, in product terms (not the tech stack). */
export interface ProjectType {
  /** e.g. "Web application", "Library / package", "Command-line tool". */
  type: string;
  /** A one-line plain description. */
  tagline: string;
  confidence: "high" | "medium" | "low";
  /** Evidence that led to the classification. */
  signals: string[];
}

/** How one contributor works, from their commit and file patterns. */
export interface ContributorFingerprint {
  author: string;
  commits: number;
  churn: number;
  /** Distinct files they ever touched. */
  filesTouched: number;
  /** Distinct top-level folders they touched. */
  dirsTouched: number;
  /** Mean number of files changed per commit. */
  avgCommitSize: number;
  /** Work-style label, e.g. "Surgical specialist", "Broad sweeper". */
  style: string;
  /** Raw tags behind the style: [size, breadth]. */
  styleTags: string[];
  /** Top folders they work in. */
  topAreas: string[];
  /** Epoch ms of their first and last commit. */
  firstCommit: number;
  lastCommit: number;
  /** The files they touched most often. */
  topFiles: string[];
}

/** A collaboration link between two contributors (shared files). */
export interface TeamLink {
  a: string;
  b: string;
  sharedFiles: number;
  /** Jaccard overlap of their file sets, 0..1. */
  jaccard: number;
}

/** How concentrated contributions are across the team. */
export interface Concentration {
  /** Gini coefficient of commits per author, 0 (even) .. 1 (concentrated). */
  gini: number;
  /** Top contributor's share of commits, percent. */
  topShare: number;
  note: string;
}

/** Team topology: who works how, who collaborates, who bridges silos. */
export interface TeamTopology {
  fingerprints: ContributorFingerprint[];
  /** Distribution concentration across contributors. */
  concentration: Concentration;
  /** Strongest collaboration links, descending. */
  links: TeamLink[];
  /** Groups that never touch the same files (potential silos). */
  silos: string[][];
  /** Contributors whose departure would fragment the team (knowledge brokers). */
  brokers: string[];
  /** Plain-language summary. */
  note: string;
}

/** One point on the health-over-time trend (cumulative health at an era's end). */
export interface HealthTrendPoint {
  index: number;
  label: string;
  t: number;
  score: number;
  grade: string;
}

/** One commit-culture dimension (a percentage, 0..100). */
export interface CultureMetric {
  name: string;
  detail: string;
  pct: number;
}

/** Engineering-culture read from commit messages, graded and trended. */
export interface CultureScore {
  score: number;
  grade: string;
  verdict: string;
  metrics: CultureMetric[];
  /** Per-era hygiene score (shows culture shift over time). */
  trend: { index: number; label: string; score: number }[];
}

/** A structurally significant moment in the repo's history. */
export interface NotableEvent {
  t: number;
  /** "rewrite" | "cleanup" | "feature" | "newcomer" | "departure". */
  kind: string;
  title: string;
  detail: string;
  author?: string;
}

/** Project conventions and infrastructure signals inferred from paths. */
export interface Conventions {
  /** Dominant file-name casing, or "mixed". */
  casing: string;
  hasCI: boolean;
  hasDocker: boolean;
  monorepo: boolean;
  hasTests: boolean;
  signals: string[];
}

/** Extended repository metrics for the Stats view. */
export interface RepoMetrics {
  /** Commit-size distribution by files-changed bucket. */
  commitSizes: { label: string; count: number }[];
  /** Commits per UTC weekday (index 0 = Sunday). */
  weekday: number[];
  /** Commits per UTC hour (0..23). */
  hour: number[];
  /** Largest current folders by churn. */
  largestDirs: { dir: string; churn: number; files: number }[];
  /** Files touched in the most recent era. */
  recentlyActive: string[];
}

/** A detected release / version bump. */
export interface Release {
  t: number;
  version: string | null;
  message: string;
  author: string;
}

/** The complete coordinator brief for one repository. */
export interface ProjectBrief {
  name: string;
  source: Source;
  /** What kind of project this is, in product terms. */
  projectType: ProjectType;
  /** One-liner: "what is this". */
  headline: string;
  /** 2-3 sentence paragraph. */
  summary: string;
  techStack: TechItem[];
  modules: ModuleInsight[];
  keyFiles: KeyFile[];
  /** Recommended reading order for someone new to the repo. */
  readingPath: ReadingStep[];
  /** Approachable files for a newcomer's first change. */
  firstFiles: FirstFile[];
  /** Domain vocabulary mined from file names. */
  glossary: GlossaryTerm[];
  /** Project-health read (bus factor, ownership, hotspots). */
  risk: RiskAnalysis;
  /** Files that tend to change together. */
  coupling: CouplingPair[];
  contributors: ContributorRole[];
  eras: Era[];
  /** The project's activity pulse (cadence, work mix, momentum). */
  activity: ActivityInsight;
  /** Commit-message culture: hygiene grade, metrics, and per-era trend. */
  culture: CultureScore;
  /** Structurally significant moments in the history. */
  events: NotableEvent[];
  /** Extended repository metrics (commit sizes, activity heatmap, largest dirs). */
  metrics: RepoMetrics;
  /** Detected releases / version bumps. */
  releases: Release[];
  /** Project conventions and infrastructure signals. */
  conventions: Conventions;
  /** A transparent 0-100 health grade for leads and managers. */
  health: HealthScore;
  /** Cumulative health grade at the end of each era (the trend over time). */
  healthTrend: HealthTrendPoint[];
  /** How the team works and collaborates (fingerprints, silos, brokers). */
  team: TeamTopology;
  narration: NarrationBeat[];
  stats: BriefStats;
}
