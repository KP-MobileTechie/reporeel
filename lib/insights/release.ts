// ---------------------------------------------------------------------------
// insights/release.ts — detect releases / version bumps from commit history.
// Signals: a semantic version in the message, an explicit "release"/"bump"
// message, or a commit that touches a manifest (package.json, Cargo.toml, …).
// Pure and deterministic; returns releases chronologically.
// ---------------------------------------------------------------------------

import type { Commit } from "@/lib/types";
import type { Release } from "./types";

const SEMVER = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/;
const RELEASE_WORDS = /\b(release|releasing|bump version|version bump|publish|tag|changelog)\b/i;
const MANIFESTS = new Set(["package.json", "cargo.toml", "pyproject.toml", "build.gradle", "pom.xml", "composer.json"]);

function baseName(path: string): string {
  return (path.split("/").pop() ?? "").toLowerCase();
}

export function detectReleases(commits: Commit[], topN = 20): Release[] {
  const out: Release[] = [];
  for (const c of commits) {
    const msg = c.message;
    const semver = msg.match(SEMVER);
    const touchesManifest = c.changes.some((ch) => MANIFESTS.has(baseName(ch.toPath ?? ch.path)));
    const isRelease = !!semver || RELEASE_WORDS.test(msg) || (touchesManifest && /\b(bump|version|release|v\d)\b/i.test(msg));
    if (!isRelease) continue;
    out.push({
      t: c.date,
      version: semver ? semver[1] : null,
      message: msg.length > 80 ? msg.slice(0, 79).trimEnd() + "…" : msg,
      author: c.author,
    });
  }
  out.sort((a, b) => a.t - b.t);
  // De-duplicate identical versions appearing back-to-back.
  const deduped: Release[] = [];
  for (const r of out) {
    const prev = deduped[deduped.length - 1];
    if (prev && r.version && prev.version === r.version) continue;
    deduped.push(r);
  }
  return deduped.slice(-topN);
}
