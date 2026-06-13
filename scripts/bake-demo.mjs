#!/usr/bin/env node
// ---------------------------------------------------------------------------
// bake-demo.mjs — turn a local git repo into a baked RepoReel demo timeline.
//
// Usage:
//   node scripts/bake-demo.mjs <path-to-local-git-repo> <id> <label> [maxCommits=3000]
//
// Example:
//   node scripts/bake-demo.mjs D:/Projects/reporeel reporeel "RepoReel"
//
// What it does:
//   - Walks `git log --no-merges --reverse` (oldest first) twice, keyed by
//     commit hash:
//       pass A (--numstat):      adds/dels per file  → delta = adds + dels
//       pass B (--name-status):  A/M/D/R status per file → ChangeType
//     We MERGE the two passes per commit/path because numstat alone cannot
//     reliably distinguish add vs modify vs delete (a delete shows `0  0`,
//     an add and a modify both show `n  0`/`n  m`). name-status gives the
//     authoritative status letter; numstat gives the churn magnitude. This is
//     the robust approach called out in the task spec.
//   - Renames: name-status emits `R<score>\told\tnew`; numstat emits either
//     `adds\tdels\told => new` or the brace form `adds dels pre{old => new}post`.
//     We normalize both to type "rename" with path=old, toPath=new. Binary
//     files show `-\t-` in numstat → delta 0.
//   - Caps to the maxCommits MOST RECENT commits: we read the full log oldest
//     first, then slice the TAIL (the last maxCommits entries) so the demo
//     keeps the freshest history while staying sorted ascending.
//   - Emits CommitTimeline JSON: repo {name:id, source:"demo"}, dates epoch ms
//     (Date.parse on the ISO author date), messages truncated to 100 chars,
//     deltas rounded (already integers from numstat, but Math.round guards).
//   - Writes public/demos/<id>.json (compact), prints commit count + file size,
//     and upserts {id,label,file:"<id>.json"} into public/demos/manifest.json.
//
// Size target: aim for <= ~1.5MB per file. If a repo blows past that, lower
// maxCommits (e.g. `... 800`).
//
// No new npm deps: only node:child_process + node:fs + node:path.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const DEMOS_DIR = join(REPO_ROOT, "public", "demos");

const [, , repoPath, id, label, maxCommitsArg] = process.argv;
if (!repoPath || !id || !label) {
  console.error(
    "Usage: node scripts/bake-demo.mjs <path-to-local-git-repo> <id> <label> [maxCommits=3000]",
  );
  process.exit(1);
}
const maxCommits = Number(maxCommitsArg) || 3000;

const SEP = "__C__";
const FIELD = "\t";

function git(args) {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
}

// Split a `git log` stream into per-commit records. Each record starts with the
// SEP-prefixed header line `__C__<hash>\t<author>\t<isoDate>\t<subject>`,
// followed by zero or more file lines until the next header / EOF.
function parseLog(raw) {
  const lines = raw.split("\n");
  const records = [];
  let cur = null;
  for (const line of lines) {
    if (line.startsWith(SEP)) {
      if (cur) records.push(cur);
      const rest = line.slice(SEP.length);
      const [hash, author, iso, ...subjParts] = rest.split(FIELD);
      cur = { hash, author, iso, subject: subjParts.join(FIELD), fileLines: [] };
    } else if (cur && line.trim() !== "") {
      cur.fileLines.push(line);
    }
  }
  if (cur) records.push(cur);
  return records;
}

// Normalize a rename path spec into { from, to }.
//   "old => new"                  → from=old, to=new
//   "src/{a => b}/file.ts"        → from=src/a/file.ts, to=src/b/file.ts
//   "{ => sub}/file.ts"           → from=file.ts, to=sub/file.ts
function splitRename(spec) {
  const brace = spec.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (brace) {
    const [, pre, a, b, post] = brace;
    const norm = (mid) => (pre + mid + post).replace(/\/\//g, "/");
    return { from: norm(a), to: norm(b) };
  }
  const arrow = spec.split(" => ");
  if (arrow.length === 2) return { from: arrow[0], to: arrow[1] };
  return { from: spec, to: spec };
}

// pass A: numstat → per-commit map of path → delta (and rename target).
function parseNumstat() {
  const raw = git([
    "log",
    "--no-merges",
    "--numstat",
    `--format=${SEP}%H${FIELD}%an${FIELD}%aI${FIELD}%s`,
    "--reverse",
  ]);
  const map = new Map(); // hash → { path → { delta, to? } }
  for (const rec of parseLog(raw)) {
    const files = new Map();
    for (const line of rec.fileLines) {
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const [addsStr, delsStr, ...pathParts] = parts;
      const pathSpec = pathParts.join("\t");
      const adds = addsStr === "-" ? 0 : parseInt(addsStr, 10) || 0;
      const dels = delsStr === "-" ? 0 : parseInt(delsStr, 10) || 0;
      const delta = adds + dels;
      if (pathSpec.includes(" => ")) {
        const { from, to } = splitRename(pathSpec);
        files.set(from, { delta, to });
      } else {
        files.set(pathSpec, { delta });
      }
    }
    map.set(rec.hash, files);
  }
  return map;
}

// pass B: name-status → per-commit map of path → { type, to? }.
function parseNameStatus() {
  const raw = git([
    "log",
    "--no-merges",
    "--name-status",
    `--format=${SEP}%H${FIELD}%an${FIELD}%aI${FIELD}%s`,
    "--reverse",
  ]);
  const order = []; // commit records in oldest-first order
  for (const rec of parseLog(raw)) {
    const files = new Map();
    for (const line of rec.fileLines) {
      const parts = line.split("\t");
      const status = parts[0];
      const letter = status[0];
      if (letter === "R" || letter === "C") {
        // R<score>\told\tnew  (copy treated as rename per types.ts note)
        const from = parts[1];
        const to = parts[2];
        files.set(from, { type: "rename", to });
      } else if (letter === "A") {
        files.set(parts[1], { type: "add" });
      } else if (letter === "D") {
        files.set(parts[1], { type: "delete" });
      } else {
        // M, T (type change), U (unmerged) → modify
        files.set(parts[1], { type: "modify" });
      }
    }
    order.push({
      hash: rec.hash,
      author: rec.author,
      iso: rec.iso,
      subject: rec.subject,
      files,
    });
  }
  return order;
}

function build() {
  const numstat = parseNumstat();
  const statusOrder = parseNameStatus();

  // Slice the TAIL: keep the maxCommits most recent commits (still asc order).
  const sliced =
    statusOrder.length > maxCommits ? statusOrder.slice(-maxCommits) : statusOrder;

  const commits = [];
  for (const rec of sliced) {
    const deltaMap = numstat.get(rec.hash) || new Map();
    const changes = [];
    for (const [path, info] of rec.files) {
      // Look up churn for this path; renames may be keyed by the old path.
      const d = deltaMap.get(path);
      const delta = Math.round((d && d.delta) || 0);
      const change = { path, type: info.type, delta };
      if (info.type === "rename" && info.to) change.toPath = info.to;
      changes.push(change);
    }
    const date = Date.parse(rec.iso);
    if (!Number.isFinite(date)) continue;
    commits.push({
      hash: rec.hash,
      author: rec.author,
      date,
      message: rec.subject.slice(0, 100),
      changes,
    });
  }

  // Guaranteed asc by --reverse + tail slice, but sort defensively.
  commits.sort((a, b) => a.date - b.date);

  return { repo: { name: id, source: "demo" }, commits };
}

function upsertManifest(file) {
  const manifestPath = join(DEMOS_DIR, "manifest.json");
  let manifest = [];
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = [];
    }
  }
  if (!Array.isArray(manifest)) manifest = [];
  const idx = manifest.findIndex((m) => m && m.id === id);
  const entry = { id, label, file };
  if (idx >= 0) manifest[idx] = entry;
  else manifest.push(entry);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return manifestPath;
}

// ── main ───────────────────────────────────────────────────────────────────
if (!existsSync(DEMOS_DIR)) mkdirSync(DEMOS_DIR, { recursive: true });

const timeline = build();
const file = `${id}.json`;
const outPath = join(DEMOS_DIR, file);
const json = JSON.stringify(timeline);
writeFileSync(outPath, json);

const bytes = Buffer.byteLength(json);
const kb = (bytes / 1024).toFixed(1);
console.log(`Baked ${timeline.commits.length} commits → ${outPath} (${kb} KB)`);
if (bytes > 1.5 * 1024 * 1024) {
  console.warn(
    `WARNING: ${kb} KB exceeds ~1.5MB target. Re-run with a lower maxCommits, e.g. ${Math.floor(maxCommits / 2)}.`,
  );
}
const manifestPath = upsertManifest(file);
console.log(`Updated manifest: ${manifestPath}`);
