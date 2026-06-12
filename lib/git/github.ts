import type { CommitTimeline, Commit, FileChange, ChangeType } from "@/lib/types";
import { AdapterError, RateLimitError } from "./errors";

export const MAX_COMMITS = 3000;

// ---------------------------------------------------------------------------
// GitHub REST shapes (subset we depend on).
// ---------------------------------------------------------------------------
export interface GithubActor {
  name?: string | null;
  date?: string | null;
}

export interface GithubCommitListItem {
  sha: string;
  commit: {
    author?: GithubActor | null;
    committer?: GithubActor | null;
    message: string;
  };
}

export interface GithubFile {
  filename: string;
  status: string;
  additions?: number;
  deletions?: number;
  previous_filename?: string;
}

export interface GithubCommitDetail extends GithubCommitListItem {
  files?: GithubFile[];
}

// Map a GitHub file "status" to our ChangeType. Returns null for statuses we
// don't model (e.g. "changed", "unchanged") so the caller can skip them.
// Per lib/types.ts: git "copy" must be mapped to "rename".
function mapStatus(status: string): ChangeType | null {
  switch (status) {
    case "added":
      return "add";
    case "modified":
      return "modify";
    case "removed":
      return "delete";
    case "renamed":
    case "copied":
      return "rename";
    default:
      return null;
  }
}

function fileToChange(f: GithubFile): FileChange | null {
  const type = mapStatus(f.status);
  if (type === null) return null;
  const delta = (f.additions ?? 0) + (f.deletions ?? 0);

  if (f.status === "renamed") {
    // previous_filename → filename
    return {
      path: f.previous_filename ?? f.filename,
      type,
      delta,
      toPath: f.filename,
    };
  }
  if (f.status === "copied") {
    // copy is modeled as a rename; the source file still exists in git, but we
    // intentionally collapse copy→rename per the types.ts contract.
    return {
      path: f.previous_filename ?? f.filename,
      type,
      delta,
      toPath: f.filename,
    };
  }
  return { path: f.filename, type, delta };
}

// ---------------------------------------------------------------------------
// normalizeGithub: pure transform from paginated list + per-commit details
// into a CommitTimeline. Commits missing from `details`, or with no usable
// date, are skipped and counted.
// ---------------------------------------------------------------------------
export function normalizeGithub(
  pages: GithubCommitListItem[][],
  details: Map<string, GithubCommitDetail>,
  owner: string,
  repo: string,
): { timeline: CommitTimeline; skipped: number } {
  const commits: Commit[] = [];
  let skipped = 0;

  for (const page of pages) {
    for (const item of page) {
      const detail = details.get(item.sha);
      if (!detail) {
        skipped++;
        continue;
      }

      const c = detail.commit;
      const dateStr = c.author?.date ?? c.committer?.date ?? undefined;
      const date = dateStr ? Date.parse(dateStr) : NaN;
      if (Number.isNaN(date)) {
        skipped++;
        continue;
      }

      const author = c.author?.name ?? c.committer?.name ?? "unknown";
      const changes: FileChange[] = [];
      for (const f of detail.files ?? []) {
        const ch = fileToChange(f);
        if (ch) changes.push(ch);
      }

      commits.push({
        hash: item.sha,
        author,
        date,
        message: c.message,
        changes,
      });
    }
  }

  commits.sort((a, b) => a.date - b.date);

  // Cap to the MOST RECENT MAX_COMMITS (keep the tail after asc sort).
  const capped =
    commits.length > MAX_COMMITS ? commits.slice(commits.length - MAX_COMMITS) : commits;

  return {
    timeline: {
      repo: { name: repo, owner, source: "github" },
      commits: capped,
    },
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Thin fetch half (not unit-tested). All HTTP/business glue, no normalization
// logic beyond delegating to normalizeGithub. The token is a function arg only:
// never stored, never logged.
// ---------------------------------------------------------------------------
const API = "https://api.github.com";

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function isRateLimited(res: Response): boolean {
  if (res.status === 429) return true;
  if (res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") return true;
    // 403 without explicit remaining header: treat as rate limit if the body
    // hints at it is handled by the caller; here we conservatively flag 403
    // with remaining 0 only. Other 403s fall through to AdapterError.
  }
  return false;
}

export async function fetchGithubTimeline(
  owner: string,
  repo: string,
  token?: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ timeline: CommitTimeline; skipped: number }> {
  const headers = buildHeaders(token);

  // Cancellation contract: callers pass an AbortSignal. We forward it to every
  // fetch (so an in-flight request rejects with the platform's AbortError /
  // DOMException), and between operations we check signal.aborted and throw an
  // AdapterError("aborted") so callers get a single, typed failure regardless
  // of exactly when the abort landed.
  const throwIfAborted = () => {
    if (signal?.aborted) throw new AdapterError("aborted");
  };

  // --- Phase 1: paginate the commit list. ---
  const pages: GithubCommitListItem[][] = [];
  const details = new Map<string, GithubCommitDetail>();

  let page = 1;
  let total = 0;
  while (total < MAX_COMMITS) {
    throwIfAborted();
    const url = `${API}/repos/${owner}/${repo}/commits?per_page=100&page=${page}`;
    const res = await fetch(url, { headers, signal });
    if (!res.ok) {
      if (isRateLimited(res)) {
        throw new RateLimitError(normalizeGithub(pages, details, owner, repo).timeline);
      }
      if (res.status === 404) throw new AdapterError("repository not found or private");
      throw new AdapterError(`github request failed (${res.status})`);
    }
    const list = (await res.json()) as GithubCommitListItem[];
    pages.push(list);
    total += list.length;
    page++;
    if (list.length < 100) break; // last page
  }

  // Flatten the list of shas we need detail for, capped to MAX_COMMITS.
  const shas: string[] = [];
  for (const p of pages) {
    for (const item of p) {
      shas.push(item.sha);
      if (shas.length >= MAX_COMMITS) break;
    }
    if (shas.length >= MAX_COMMITS) break;
  }

  // --- Phase 2: fetch each commit detail with a concurrency-8 promise pool. ---
  //
  // Shutdown contract: a single shared `stopped` flag coordinates the pool. The
  // first worker to hit a rate limit sets `rateLimited = true` and `stopped =
  // true`; every worker checks `stopped` at the top of its loop and exits
  // cleanly (no further fetches, no racing throws). We await ALL workers with
  // Promise.allSettled so none rejects unhandled. Only AFTER the pool fully
  // drains do we throw — and we rebuild the RateLimitError from the FINAL
  // `details` map, so commit details that completed successfully before the
  // drain are still included in the partial timeline. A hard error (404 / other
  // non-OK status) likewise stops the pool and is rethrown after drain.
  let done = 0;
  let cursor = 0;
  const CONCURRENCY = 8;

  let stopped = false;
  let rateLimited = false;
  let hardError: Error | null = null;

  async function worker(): Promise<void> {
    while (!stopped && cursor < shas.length) {
      throwIfAborted();
      const sha = shas[cursor++];
      const url = `${API}/repos/${owner}/${repo}/commits/${sha}`;
      const res = await fetch(url, { headers, signal });
      if (!res.ok) {
        if (isRateLimited(res)) {
          rateLimited = true;
          stopped = true;
          return;
        }
        hardError =
          res.status === 404
            ? new AdapterError("repository not found or private")
            : new AdapterError(`github request failed (${res.status})`);
        stopped = true;
        return;
      }
      const detail = (await res.json()) as GithubCommitDetail;
      details.set(sha, detail);
      done++;
      onProgress?.(done, shas.length);
    }
  }

  await Promise.allSettled(
    Array.from({ length: Math.min(CONCURRENCY, shas.length) }, () => worker()),
  );

  // After the pool has fully drained, surface any terminal condition. Rebuild
  // from the final details map so concurrent successes are not lost.
  throwIfAborted();
  if (hardError) throw hardError;
  if (rateLimited) {
    throw new RateLimitError(normalizeGithub(pages, details, owner, repo).timeline);
  }

  return normalizeGithub(pages, details, owner, repo);
}
