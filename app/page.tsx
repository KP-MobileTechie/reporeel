"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LandingHero } from "@/components/LandingHero";
import { TimelineBar } from "@/components/TimelineBar";
import { StatsOverlay, type Stats } from "@/components/StatsOverlay";
import { Leaderboard, type LeaderRow } from "@/components/Leaderboard";
import { ThemePicker } from "@/components/ThemePicker";
import type { DemoEntry, LocalFiles } from "@/components/InputRow";
import { useGalaxy } from "@/lib/useGalaxy";
import { loadDemo } from "@/lib/git/demo";
import { fetchGithubTimeline } from "@/lib/git/github";
import { parseLocalRepo } from "@/lib/git/local";
import { AdapterError, RateLimitError } from "@/lib/git/errors";
import { WebGLUnsupportedError } from "@/engine/renderer";
import type { CommitTimeline } from "@/lib/types";
import type { Theme } from "@/lib/colors";

type AppState = "landing" | "loading" | "theater" | "error";

interface LoadProgress {
  source: "local" | "github";
  done: number;
  total: number;
}

const SPEED_STEPS = [1, 5, 25, 100];

export default function Home() {
  const [state, setState] = useState<AppState>("landing");
  const [timeline, setTimeline] = useState<CommitTimeline | null>(null);
  const [theme, setTheme] = useState<Theme>("nebula");
  const [errorMsg, setErrorMsg] = useState("");
  const [webglUnsupported, setWebglUnsupported] = useState(false);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [demos, setDemos] = useState<DemoEntry[]>([]);
  const [rateLimit, setRateLimit] = useState<{ commitsLoaded: number; partial: CommitTimeline } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelLocalRef = useRef<(() => void) | null>(null);

  // Sample demo timeline drives the landing-page background galaxy.
  const [sampleTimeline, setSampleTimeline] = useState<CommitTimeline | null>(null);

  // The galaxy hook: in theater it uses the loaded timeline; on landing the
  // sample timeline with calm looping autoplay.
  const isTheater = state === "theater";
  const activeTimeline = isTheater ? timeline : sampleTimeline;
  const galaxyOptions = useMemo(
    () => (isTheater ? undefined : { autoplay: { speed: 8, loop: true } }),
    [isTheater],
  );
  const { handle, error: galaxyError } = useGalaxy(canvasRef, activeTimeline, theme, galaxyOptions);

  // ── Load demo manifest once ───────────────────────────────────────────
  useEffect(() => {
    fetch("/demos/manifest.json")
      .then((r) => r.json())
      .then((m: DemoEntry[]) => setDemos(m))
      .catch(() => setDemos([]));
  }, []);

  // ── Load the sample demo for the landing background ───────────────────
  useEffect(() => {
    fetch("/demos/sample.json")
      .then((r) => r.json())
      .then((j) => setSampleTimeline(loadDemo(j)))
      .catch(() => setSampleTimeline(null));
  }, []);

  // ── Galaxy errors (WebGL unsupported / context lost / empty repo) ─────
  useEffect(() => {
    if (!galaxyError) return;
    if (galaxyError instanceof WebGLUnsupportedError) {
      setWebglUnsupported(true);
    } else {
      setErrorMsg(galaxyError.message);
    }
    // Only surface as a full error screen when in theater (landing tolerates
    // a missing background gracefully unless WebGL is unsupported).
    if (isTheater || galaxyError instanceof WebGLUnsupportedError) {
      setState("error");
    }
  }, [galaxyError, isTheater]);

  // ── Loaders ───────────────────────────────────────────────────────────
  const enterTheater = useCallback((ct: CommitTimeline) => {
    if (ct.commits.length === 0) {
      setErrorMsg("This repository has no commits yet.");
      setState("error");
      return;
    }
    setTimeline(ct);
    setRateLimit(null);
    setProgress(null);
    setState("theater");
  }, []);

  const loadGithub = useCallback(
    async (owner: string, repo: string, token?: string) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setRateLimit(null);
      setProgress({ source: "github", done: 0, total: 0 });
      setState("loading");
      try {
        const { timeline: ct } = await fetchGithubTimeline(
          owner,
          repo,
          token,
          (done, total) => setProgress({ source: "github", done, total }),
          ac.signal,
        );
        if (ac.signal.aborted) return;
        enterTheater(ct);
      } catch (err) {
        if (ac.signal.aborted) return;
        if (err instanceof RateLimitError) {
          setRateLimit({ commitsLoaded: err.partial.commits.length, partial: err.partial });
          setState("landing");
        } else if (err instanceof AdapterError && err.message === "aborted") {
          setState("landing");
        } else {
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setState("error");
        }
      }
    },
    [enterTheater],
  );

  const loadLocal = useCallback(
    (lf: LocalFiles) => {
      setProgress({ source: "local", done: 0, total: 0 });
      setState("loading");
      cancelLocalRef.current?.();
      cancelLocalRef.current = parseLocalRepo(
        lf.files,
        lf.repoName,
        (done, total) => setProgress({ source: "local", done, total }),
        ({ timeline: ct }) => {
          cancelLocalRef.current = null;
          enterTheater(ct);
        },
        (err) => {
          cancelLocalRef.current = null;
          setErrorMsg(err.message);
          setState("error");
        },
      );
    },
    [enterTheater],
  );

  const loadDemoById = useCallback(
    async (id: string) => {
      const entry = demos.find((d) => d.id === id);
      if (!entry) return;
      setState("loading");
      setProgress({ source: "local", done: 0, total: 0 });
      try {
        const r = await fetch(`/demos/${entry.file}`);
        const ct = loadDemo(await r.json());
        enterTheater(ct);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setState("error");
      }
    },
    [demos, enterTheater],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    cancelLocalRef.current?.();
    cancelLocalRef.current = null;
    setTimeline(null);
    setErrorMsg("");
    setWebglUnsupported(false);
    setProgress(null);
    setState("landing");
  }, []);

  // ── URL params on mount: ?repo=owner/name or ?demo=id ─────────────────
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const repo = params.get("repo");
    const demo = params.get("demo");
    if (repo && repo.includes("/")) {
      const [owner, name] = repo.split("/");
      if (owner && name) loadGithub(owner, name);
    } else if (demo) {
      // Wait for the manifest fetch; loadDemoById finds the entry.
      void demo;
    }
  }, [loadGithub]);

  // Handle ?demo=id once demos are loaded.
  const demoParamHandled = useRef(false);
  useEffect(() => {
    if (demoParamHandled.current || demos.length === 0) return;
    const demo = new URLSearchParams(window.location.search).get("demo");
    if (demo) {
      demoParamHandled.current = true;
      loadDemoById(demo);
    }
  }, [demos, loadDemoById]);

  // ── Cleanup on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      cancelLocalRef.current?.();
    };
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-bg">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full touch-none" />

      {state === "landing" && !webglUnsupported && (
        <LandingHero
          demos={demos}
          busy={false}
          rateLimit={rateLimit}
          onLocal={loadLocal}
          onGithub={loadGithub}
          onDemo={loadDemoById}
          onContinuePartial={() => rateLimit && enterTheater(rateLimit.partial)}
        />
      )}

      {state === "loading" && <LoadingView progress={progress} onCancel={reset} />}

      {state === "theater" && handle && (
        <Theater
          handle={handle}
          repoName={timeline?.repo.name ?? "repository"}
          theme={theme}
          onTheme={setTheme}
          onExit={reset}
        />
      )}

      {(state === "error" || webglUnsupported) && (
        <ErrorView
          message={webglUnsupported ? "RepoReel needs WebGL2." : errorMsg}
          onRetry={reset}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Loading view
// ---------------------------------------------------------------------------
function LoadingView({
  progress,
  onCancel,
}: {
  progress: LoadProgress | null;
  onCancel: () => void;
}) {
  const label =
    progress?.source === "local"
      ? `reading repository… ${progress.done}/${progress.total || "?"} commits`
      : `fetching commits… ${progress?.done ?? 0}/${progress?.total || "?"}`;
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-bg/80">
      <div className="text-fg-dim">{label}</div>
      {progress?.source === "github" && (
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-4 py-2 text-sm text-fg hover:border-accent"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error view
// ---------------------------------------------------------------------------
function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-border bg-surface p-8 text-center">
        <h2 className="text-lg font-semibold text-fg">Something went wrong</h2>
        <p className="mt-2 text-sm text-fg-dim">{message || "Unexpected error."}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110"
        >
          Try another repo
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Theater: overlays + timeline bar wired to the galaxy handle.
//
// Reads playback state from the handle on a throttled timer (4 Hz) to drive
// the scrubber + month label + stats; never per-frame setState.
// ---------------------------------------------------------------------------
function Theater({
  handle,
  repoName,
  theme,
  onTheme,
  onExit,
}: {
  handle: NonNullable<ReturnType<typeof useGalaxy>["handle"]>;
  repoName: string;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onExit: () => void;
}) {
  const { timeline } = handle;
  const degenerate = timeline.t1 <= timeline.t0;

  // Precompute commit times (sorted) for sparkline + binary-search counts.
  const commitTimes = useMemo(
    () => timeline.supernovas.map((s) => s.t),
    [timeline],
  );

  // Per-author commit times (sorted) for the leaderboard.
  const authorTimes = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const sn of timeline.supernovas) {
      let arr = map.get(sn.author);
      if (!arr) {
        arr = [];
        map.set(sn.author, arr);
      }
      arr.push(sn.t);
    }
    return map;
  }, [timeline]);

  const totalContributors = authorTimes.size;

  // Throttled UI state (4 Hz).
  const [t, setT] = useState(timeline.t0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [stats, setStats] = useState<Stats>({
    repoName,
    aliveCount: 0,
    commitsDone: 0,
    commitsTotal: commitTimes.length,
    contributors: totalContributors,
  });
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);

  const scrubbingRef = useRef(false);
  const resumeAfterScrubRef = useRef(false);

  // upperBound: count of times <= target.
  const countLE = (arr: number[], target: number) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid] <= target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  // 4 Hz read of playback → scrubber + month label.
  useEffect(() => {
    const id = window.setInterval(() => {
      const pb = handle.getPlayback();
      if (!scrubbingRef.current) setT(pb.t);
      setPlaying(pb.playing);
      setSpeed(pb.speed);
    }, 100);
    return () => window.clearInterval(id);
  }, [handle]);

  // 250ms stats; 500ms leaderboard (computed together at 250 with leaderboard
  // recompute gated to every other tick).
  useEffect(() => {
    let tickN = 0;
    const id = window.setInterval(() => {
      const pb = handle.getPlayback();
      const ct = pb.t;
      const aliveCount = handle.timeline.stars.reduce((acc, s) => {
        return acc + (s.birth <= ct && (s.death === null || s.death > ct) ? 1 : 0);
      }, 0);
      setStats({
        repoName,
        aliveCount,
        commitsDone: countLE(commitTimes, ct),
        commitsTotal: commitTimes.length,
        contributors: totalContributors,
      });
      // Leaderboard every 500ms.
      if (tickN % 2 === 0) {
        const rows: LeaderRow[] = [];
        for (const [author, times] of authorTimes) {
          const c = countLE(times, ct);
          if (c > 0) rows.push({ author, commits: c });
        }
        rows.sort((a, b) => b.commits - a.commits);
        setLeaders(rows.slice(0, 5));
      }
      tickN++;
    }, 250);
    return () => window.clearInterval(id);
  }, [handle, commitTimes, authorTimes, totalContributors, repoName]);

  // ── Keyboard controls ──────────────────────────────────────────────────
  useEffect(() => {
    if (degenerate) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const pb = handle.getPlayback();
      const span = timeline.t1 - timeline.t0;
      if (e.code === "Space") {
        e.preventDefault();
        pb.playing ? handle.pause() : handle.play();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        handle.seek(pb.t - span * 0.02);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        handle.seek(pb.t + span * 0.02);
      } else if (e.key === "+" || e.key === "=") {
        const i = SPEED_STEPS.findIndex((s) => s >= pb.speed);
        handle.setSpeed(SPEED_STEPS[Math.min(SPEED_STEPS.length - 1, i + 1)]);
      } else if (e.key === "-" || e.key === "_") {
        const i = SPEED_STEPS.findIndex((s) => s >= pb.speed);
        handle.setSpeed(SPEED_STEPS[Math.max(0, i - 1)]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handle, timeline, degenerate]);

  return (
    <>
      {/* Top-left stats */}
      <div className="absolute left-4 top-4 z-10">
        <StatsOverlay stats={stats} />
      </div>

      {/* Top-right leaderboard + theme picker */}
      <div className="absolute right-4 top-4 z-10 flex flex-col items-end gap-2">
        <ThemePicker theme={theme} onChange={onTheme} />
        <Leaderboard rows={leaders} />
        <button
          type="button"
          onClick={onExit}
          className="pointer-events-auto rounded-lg bg-black/40 px-3 py-1.5 text-xs text-fg-dim backdrop-blur hover:text-fg"
        >
          ← new repo
        </button>
      </div>

      {/* Bottom timeline */}
      <div className="absolute inset-x-4 bottom-4 z-10">
        <TimelineBar
          t0={timeline.t0}
          t1={timeline.t1}
          t={t}
          playing={playing}
          speed={speed}
          commitTimes={commitTimes}
          disabled={degenerate}
          onPlayPause={() => (playing ? handle.pause() : handle.play())}
          onSpeed={(s) => handle.setSpeed(s)}
          onSeek={(val) => {
            setT(val);
            handle.seek(val);
          }}
          onScrubStart={() => {
            scrubbingRef.current = true;
            resumeAfterScrubRef.current = handle.getPlayback().playing;
            handle.pause();
          }}
          onScrubEnd={() => {
            scrubbingRef.current = false;
            if (resumeAfterScrubRef.current) handle.play();
          }}
        />
      </div>
    </>
  );
}
