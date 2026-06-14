#!/usr/bin/env node
// ---------------------------------------------------------------------------
// generate-onboarding.mjs — produce an ONBOARDING.md for a git repo from the
// command line / CI, using the SAME deterministic insight engine the web app
// runs (lib/insights). It walks `git log`, builds a CommitTimeline, bundles
// buildBrief + briefToMarkdown with esbuild (so there's no duplicated logic),
// and writes ONBOARDING.md. Zero backend, zero services — it runs anywhere
// git and Node are available, which makes it a drop-in GitHub Action step.
//
// Usage:
//   node scripts/generate-onboarding.mjs [repoPath=.] [outFile=ONBOARDING.md] [maxCommits=4000]
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [, , repoArg = ".", outArg = "ONBOARDING.md", maxArg] = process.argv;
const repoPath = resolve(repoArg);
const outFile = resolve(outArg);
const maxCommits = Number(maxArg) || 4000;

const SEP = "__C__";
const FIELD = "\t";

function git(args) {
  return execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
}

function parseLog(raw) {
  const records = [];
  let cur = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith(SEP)) {
      if (cur) records.push(cur);
      const [hash, author, iso, ...subj] = line.slice(SEP.length).split(FIELD);
      cur = { hash, author, iso, subject: subj.join(FIELD), fileLines: [] };
    } else if (cur && line.trim() !== "") {
      cur.fileLines.push(line);
    }
  }
  if (cur) records.push(cur);
  return records;
}

function splitRename(spec) {
  const brace = spec.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (brace) {
    const [, pre, a, b, post] = brace;
    const norm = (mid) => (pre + mid + post).replace(/\/\//g, "/");
    return { from: norm(a), to: norm(b) };
  }
  const arrow = spec.split(" => ");
  return arrow.length === 2 ? { from: arrow[0], to: arrow[1] } : { from: spec, to: spec };
}

function buildTimeline() {
  const fmt = `--format=${SEP}%H${FIELD}%an${FIELD}%aI${FIELD}%s`;
  const numstat = new Map();
  for (const rec of parseLog(git(["log", "--no-merges", "--numstat", fmt, "--reverse"]))) {
    const files = new Map();
    for (const line of rec.fileLines) {
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const [addsS, delsS, ...pp] = parts;
      const pathSpec = pp.join("\t");
      const adds = addsS === "-" ? 0 : parseInt(addsS, 10) || 0;
      const dels = delsS === "-" ? 0 : parseInt(delsS, 10) || 0;
      if (pathSpec.includes(" => ")) files.set(splitRename(pathSpec).from, { delta: adds + dels });
      else files.set(pathSpec, { delta: adds + dels });
    }
    numstat.set(rec.hash, files);
  }
  const order = [];
  for (const rec of parseLog(git(["log", "--no-merges", "--name-status", fmt, "--reverse"]))) {
    const files = new Map();
    for (const line of rec.fileLines) {
      const parts = line.split("\t");
      const letter = parts[0][0];
      if (letter === "R" || letter === "C") files.set(parts[1], { type: "rename", to: parts[2] });
      else if (letter === "A") files.set(parts[1], { type: "add" });
      else if (letter === "D") files.set(parts[1], { type: "delete" });
      else files.set(parts[1], { type: "modify" });
    }
    order.push({ hash: rec.hash, author: rec.author, iso: rec.iso, subject: rec.subject, files });
  }
  const sliced = order.length > maxCommits ? order.slice(-maxCommits) : order;
  const commits = [];
  for (const rec of sliced) {
    const deltas = numstat.get(rec.hash) || new Map();
    const changes = [];
    for (const [path, info] of rec.files) {
      const d = deltas.get(path);
      const change = { path, type: info.type, delta: Math.round((d && d.delta) || 0) };
      if (info.type === "rename" && info.to) change.toPath = info.to;
      changes.push(change);
    }
    const date = Date.parse(rec.iso);
    if (Number.isFinite(date)) commits.push({ hash: rec.hash, author: rec.author, date, message: rec.subject.slice(0, 100), changes });
  }
  commits.sort((a, b) => a.date - b.date);
  const name = repoPath.split(/[/\\]/).filter(Boolean).pop() || "repository";
  return { repo: { name, source: "local" }, commits };
}

async function loadEngine() {
  const tmp = mkdtempSync(join(tmpdir(), "reporeel-"));
  const outfile = join(tmp, "engine.mjs");
  await build({
    stdin: {
      contents: `export { buildBrief } from "@/lib/insights/brief";\nexport { briefToMarkdown } from "@/lib/insights/markdown";`,
      resolveDir: REPO_ROOT,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    alias: { "@": REPO_ROOT },
    logLevel: "silent",
  });
  const mod = await import(`file://${outfile}`);
  rmSync(tmp, { recursive: true, force: true });
  return mod;
}

const timeline = buildTimeline();
if (timeline.commits.length === 0) {
  console.error("No commits found in", repoPath);
  process.exit(1);
}
const { buildBrief, briefToMarkdown } = await loadEngine();
const brief = buildBrief(timeline);
writeFileSync(outFile, briefToMarkdown(brief));
console.log(`Wrote ${outFile} — ${brief.name}: ${brief.health.score}/100 (${brief.health.grade}), ${brief.stats.totalCommits} commits, ${brief.modules.length} modules.`);
