"use client";

// ---------------------------------------------------------------------------
// /embed — a minimal, controls-free RepoReel view for embedding in a README or
// docs site via an <iframe>. Reads ?demo=<id> or ?repo=<owner>/<name>, renders
// a calm looping galaxy with a compact health badge overlaid. Fully client-side
// and static-exported, so embedding it costs nothing to serve.
//
//   <iframe src="https://reporeel-fawn.vercel.app/embed?demo=reporeel"
//           width="640" height="360" style="border:0;border-radius:12px" />
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { useGalaxy } from "@/lib/useGalaxy";
import { loadDemo } from "@/lib/git/demo";
import { fetchGithubTimeline } from "@/lib/git/github";
import { buildBrief } from "@/lib/insights/brief";
import type { CommitTimeline } from "@/lib/types";

const GRADE_COLOR: Record<string, string> = { A: "#6ee6a0", B: "#9ae65a", C: "#fabe5a", D: "#fb921e", F: "#fa6666" };

export default function Embed() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [timeline, setTimeline] = useState<CommitTimeline | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const demo = params.get("demo");
    const repo = params.get("repo");
    let cancelled = false;
    (async () => {
      try {
        if (demo) {
          const manifest = await fetch("/demos/manifest.json").then((r) => r.json());
          const entry = Array.isArray(manifest) ? manifest.find((m) => m?.id === demo) : null;
          const file = entry?.file ?? `${demo}.json`;
          const json = await fetch(`/demos/${file}`).then((r) => r.json());
          if (!cancelled) setTimeline(loadDemo(json));
        } else if (repo && repo.includes("/")) {
          const [owner, name] = repo.split("/");
          const { timeline: ct } = await fetchGithubTimeline(owner, name);
          if (!cancelled) setTimeline(ct);
        } else {
          setErr("Add ?demo=<id> or ?repo=<owner>/<name> to embed a repository.");
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load repository.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(() => ({ autoplay: { speed: 12, loop: true } }), []);
  useGalaxy(canvasRef, timeline, "nebula", options);
  const brief = useMemo(() => (timeline ? buildBrief(timeline) : null), [timeline]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-bg">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />

      {brief && (
        <a
          href={`/?${new URLSearchParams(window.location.search).toString()}`}
          target="_blank"
          rel="noreferrer"
          className="absolute left-3 top-3 flex items-center gap-3 rounded-xl border border-border bg-black/50 px-3 py-2 backdrop-blur"
          title="Open in RepoReel"
        >
          <span
            className="flex h-9 w-9 flex-col items-center justify-center rounded-full border-2 text-sm font-bold"
            style={{ borderColor: GRADE_COLOR[brief.health.grade] ?? "#8b91b3", color: GRADE_COLOR[brief.health.grade] ?? "#8b91b3" }}
          >
            {brief.health.grade}
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold text-fg">{brief.name}</span>
            <span className="block text-[11px] text-fg-dim">
              {brief.stats.totalCommits.toLocaleString()} commits · {brief.stats.contributors} contributor
              {brief.stats.contributors === 1 ? "" : "s"} · health {brief.health.score}/100
            </span>
          </span>
        </a>
      )}

      <div className="absolute bottom-2 right-3 text-[10px] text-fg-dim">
        <a href="/" target="_blank" rel="noreferrer" className="hover:text-fg">
          ✦ RepoReel
        </a>
      </div>

      {err && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-fg-dim">{err}</div>
      )}
    </main>
  );
}
