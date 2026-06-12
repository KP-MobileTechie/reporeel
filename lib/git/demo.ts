import type { CommitTimeline, Commit, FileChange, ChangeType } from "@/lib/types";
import { AdapterError } from "./errors";

const VALID_CHANGE_TYPES: ReadonlySet<string> = new Set<ChangeType>([
  "add",
  "modify",
  "delete",
  "rename",
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(): never {
  throw new AdapterError("invalid demo timeline");
}

// ---------------------------------------------------------------------------
// loadDemo: validate an untrusted JSON blob against the CommitTimeline shape,
// then return it sorted by commit date ascending. Throws AdapterError on any
// structural violation (the fixture is bundled, but we never trust shape).
// ---------------------------------------------------------------------------
export function loadDemo(json: unknown): CommitTimeline {
  if (!isObject(json)) fail();

  const repo = json.repo;
  if (!isObject(repo)) fail();
  if (typeof repo.name !== "string") fail();
  if (repo.source !== "demo") fail();

  const rawCommits = json.commits;
  if (!Array.isArray(rawCommits)) fail();

  const commits: Commit[] = rawCommits.map((c): Commit => {
    if (!isObject(c)) fail();
    if (typeof c.hash !== "string") fail();
    if (typeof c.author !== "string") fail();
    if (typeof c.date !== "number" || !Number.isFinite(c.date)) fail();
    if (typeof c.message !== "string") fail();
    if (!Array.isArray(c.changes)) fail();

    const changes: FileChange[] = c.changes.map((ch): FileChange => {
      if (!isObject(ch)) fail();
      if (typeof ch.path !== "string") fail();
      if (typeof ch.type !== "string" || !VALID_CHANGE_TYPES.has(ch.type)) fail();
      if (typeof ch.delta !== "number" || !Number.isFinite(ch.delta)) fail();
      if (ch.toPath !== undefined && typeof ch.toPath !== "string") fail();
      const out: FileChange = {
        path: ch.path,
        type: ch.type as ChangeType,
        delta: ch.delta,
      };
      if (typeof ch.toPath === "string") out.toPath = ch.toPath;
      return out;
    });

    return {
      hash: c.hash,
      author: c.author,
      date: c.date,
      message: c.message,
      changes,
    };
  });

  // Do not assume the source is pre-sorted.
  commits.sort((a, b) => a.date - b.date);

  return {
    repo: { name: repo.name, source: "demo" },
    commits,
  };
}
