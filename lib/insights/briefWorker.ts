/// <reference lib="webworker" />
// ---------------------------------------------------------------------------
// briefWorker.ts — compute the ProjectBrief off the main thread. On a large
// repo, buildBrief (aggregate + ~30 insight passes) can take long enough to
// jank the UI; running it here keeps the galaxy interactive. The ProjectBrief
// is plain JSON, so it structured-clones back cheaply. useProjectBrief falls
// back to a synchronous build if the worker errors or is slow, so this is a
// pure performance optimization with no correctness risk.
// ---------------------------------------------------------------------------

import { buildBrief } from "./brief";
import type { CommitTimeline } from "@/lib/types";

self.onmessage = (e: MessageEvent<CommitTimeline>) => {
  const post = (self as unknown as DedicatedWorkerGlobalScope).postMessage.bind(self);
  try {
    post({ ok: true, brief: buildBrief(e.data) });
  } catch (err) {
    post({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
