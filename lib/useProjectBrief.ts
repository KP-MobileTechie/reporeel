"use client";

// ---------------------------------------------------------------------------
// useProjectBrief — build the ProjectBrief for a CommitTimeline off the main
// thread (briefWorker), keeping the galaxy responsive on large repos. Safety
// is layered: if the Worker can't be created, or doesn't respond within a
// short budget, we compute synchronously instead. So the brief ALWAYS arrives
// — the worker is a pure speedup, never a new failure mode.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { buildBrief } from "./insights/brief";
import type { CommitTimeline } from "./types";
import type { ProjectBrief } from "./insights/types";

const FALLBACK_MS = 4000;

export function useProjectBrief(ct: CommitTimeline | null): { brief: ProjectBrief | null; loading: boolean } {
  const [brief, setBrief] = useState<ProjectBrief | null>(null);
  const [loading, setLoading] = useState<boolean>(!!ct);

  useEffect(() => {
    if (!ct) {
      setBrief(null);
      setLoading(false);
      return;
    }
    setBrief(null);
    setLoading(true);

    let done = false;
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (b: ProjectBrief) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      worker?.terminate();
      setBrief(b);
      setLoading(false);
    };
    const fallback = () => {
      if (done) return;
      try {
        finish(buildBrief(ct));
      } catch {
        done = true;
        if (timer) clearTimeout(timer);
        setLoading(false);
      }
    };

    timer = setTimeout(fallback, FALLBACK_MS); // never hang

    try {
      worker = new Worker(new URL("./insights/briefWorker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent) => {
        const d = e.data as { ok?: boolean; brief?: ProjectBrief };
        if (d?.ok && d.brief) finish(d.brief);
        else fallback();
      };
      worker.onerror = () => fallback();
      worker.postMessage(ct);
    } catch {
      fallback();
    }

    return () => {
      done = true;
      if (timer) clearTimeout(timer);
      worker?.terminate();
    };
  }, [ct]);

  return { brief, loading };
}
