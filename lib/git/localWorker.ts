/// <reference lib="webworker" />
import git from "isomorphic-git";
import type { LocalLogEntry, ParseRequest, WorkerMessage } from "./local";
import { MAX_COMMITS } from "./github";
import { MemFs, diffTrees } from "./walkDiff";

// ---------------------------------------------------------------------------
// Memory note: every mounted `.git` byte lives in a Map<string, Uint8Array> in
// this worker's heap, and isomorphic-git decompresses objects on top of that.
// Browsers cap worker heaps well below the device's total RAM, so we refuse
// repos whose raw `.git` payload exceeds 800 MB rather than risk an opaque
// out-of-memory crash that surfaces as a generic worker error.
// ---------------------------------------------------------------------------
const MAX_GIT_BYTES = 800 * 1024 * 1024; // 800 MB

// ---------------------------------------------------------------------------
// Message handler.
// ---------------------------------------------------------------------------
async function handleParse(req: ParseRequest): Promise<void> {
  // Memory guard: reject oversized uploads before allocating the fs / git ops.
  let totalBytes = 0;
  for (const f of req.files) totalBytes += f.data.byteLength;
  if (totalBytes > MAX_GIT_BYTES) {
    post({
      type: "error",
      code: "parse-failed",
      message: "repository too large to parse in the browser (>800MB .git)",
    });
    return;
  }

  const fs = new MemFs(req.files);

  // not-a-repo guard: a real repo must have .git/HEAD.
  const hasHead = req.files.some((f) => {
    const p = f.path.replace(/\\/g, "/");
    return p.endsWith("/.git/HEAD") || p.endsWith(".git/HEAD") || p === ".git/HEAD";
  });
  if (!hasHead) {
    post({ type: "error", code: "not-a-repo", message: "no .git/HEAD found" });
    return;
  }

  let commits;
  try {
    commits = await git.log({ fs: fs as never, dir: "/", depth: MAX_COMMITS });
  } catch (e) {
    post({
      type: "error",
      code: "parse-failed",
      message: e instanceof Error ? e.message : "git log failed",
    });
    return;
  }

  // git.log returns newest-first. For each consecutive pair (newer, older) we
  // diff older→newer. The oldest commit (last in the list) is diffed against
  // null (all-add).
  const entries: LocalLogEntry[] = [];
  let skippedInWalk = 0;
  const total = commits.length;

  for (let i = 0; i < commits.length; i++) {
    const cur = commits[i];
    const parent = i + 1 < commits.length ? commits[i + 1] : null;
    try {
      const changes = await diffTrees(fs, parent ? parent.oid : null, cur.oid);
      entries.push({
        oid: cur.oid,
        author: cur.commit.author.name || "unknown",
        timestamp: cur.commit.author.timestamp, // seconds
        message: cur.commit.message,
        changes,
      });
    } catch {
      skippedInWalk++;
    }
    post({ type: "progress", done: i + 1, total });
  }

  post({ type: "done", entries, skippedInWalk });
}

function post(msg: WorkerMessage): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

self.onmessage = (ev: MessageEvent<ParseRequest>) => {
  if (ev.data?.type === "parse") {
    void handleParse(ev.data);
  }
};
