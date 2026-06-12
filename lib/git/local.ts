import type { CommitTimeline, Commit, FileChange, ChangeType } from "@/lib/types";
import { MAX_COMMITS } from "./github";
import { AdapterError } from "./errors";

export { MAX_COMMITS };

// ---------------------------------------------------------------------------
// Worker protocol types (shared between local.ts and localWorker.ts).
// ---------------------------------------------------------------------------

// A single git log entry produced by the worker. timestamp is in SECONDS
// (git's native unit); normalizeLocal converts to ms.
export interface LocalLogEntry {
  oid: string;
  author: string;
  timestamp: number; // seconds since epoch
  message: string;
  changes: { path: string; type: ChangeType; delta: number; toPath?: string }[];
}

// Main thread → worker.
export interface ParseRequest {
  type: "parse";
  files: { path: string; data: Uint8Array }[];
}

// Worker → main thread.
export interface ProgressMessage {
  type: "progress";
  done: number;
  total: number;
}
export interface DoneMessage {
  type: "done";
  entries: LocalLogEntry[];
  skippedInWalk: number;
}
export interface ErrorMessage {
  type: "error";
  code: "not-a-repo" | "parse-failed";
  message: string;
}
export type WorkerMessage = ProgressMessage | DoneMessage | ErrorMessage;

// ---------------------------------------------------------------------------
// normalizeLocal: pure transform from worker log entries → CommitTimeline.
// Converts timestamp seconds → ms, sorts ascending, caps to the most recent
// MAX_COMMITS. Pure and unit-tested.
// ---------------------------------------------------------------------------
export function normalizeLocal(
  entries: LocalLogEntry[],
  repoName: string,
): { timeline: CommitTimeline; skipped: number } {
  const commits: Commit[] = entries.map((e): Commit => {
    const changes: FileChange[] = e.changes.map((c) => {
      const out: FileChange = { path: c.path, type: c.type, delta: c.delta };
      if (c.toPath !== undefined) out.toPath = c.toPath;
      return out;
    });
    return {
      hash: e.oid,
      author: e.author,
      date: e.timestamp * 1000, // seconds → ms
      message: e.message,
      changes,
    };
  });

  commits.sort((a, b) => a.date - b.date);

  const capped =
    commits.length > MAX_COMMITS ? commits.slice(commits.length - MAX_COMMITS) : commits;

  return {
    timeline: {
      repo: { name: repoName, source: "local" },
      commits: capped,
    },
    skipped: 0,
  };
}

// ---------------------------------------------------------------------------
// parseLocalRepo: thin wrapper that spawns the worker and wires up messages.
// The main thread (Task 8) is responsible for walking `dirHandle`, collecting
// the `.git/**` file blobs, and this function posts them to the worker. Not
// unit-tested (browser-only plumbing).
// ---------------------------------------------------------------------------
export function parseLocalRepo(
  files: { path: string; data: Uint8Array }[],
  repoName: string,
  onProgress: (done: number, total: number) => void,
  onDone: (result: { timeline: CommitTimeline; skipped: number }) => void,
  onError: (err: Error) => void,
): () => void {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./localWorker.ts", import.meta.url), { type: "module" });
  } catch (e) {
    onError(e instanceof Error ? e : new AdapterError("failed to start local worker"));
    return () => {};
  }

  worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
    const msg = ev.data;
    switch (msg.type) {
      case "progress":
        onProgress(msg.done, msg.total);
        break;
      case "done": {
        const result = normalizeLocal(msg.entries, repoName);
        result.skipped = msg.skippedInWalk;
        onDone(result);
        worker.terminate();
        break;
      }
      case "error":
        onError(new AdapterError(msg.message));
        worker.terminate();
        break;
    }
  };
  worker.onerror = (ev) => {
    onError(new AdapterError(ev.message || "local worker crashed"));
    worker.terminate();
  };

  const req: ParseRequest = { type: "parse", files };
  worker.postMessage(req);

  // Return a cancel handle.
  return () => worker.terminate();
}
