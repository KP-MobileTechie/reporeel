"use client";

// ---------------------------------------------------------------------------
// useGalaxy — the integration hook that wires a CommitTimeline into a live,
// playing galaxy on a <canvas>.
//
// Pipeline (run once per timeline+canvas, torn down on change/unmount):
//   CommitTimeline → buildTimeline → prepare → spawn layout worker (init) →
//   Renderer(canvas) → per-frame rAF loop:
//     tick playback (wallDt from rAF timestamps)
//     → sceneAtTime
//     → renderer.setScene(scene, latestLayoutFrame, colors)
//     → worker.tick (paused when document.hidden)
//
// Colors are rebuilt from stars[i].lang via colorOf(lang, theme) on theme
// change without recreating the renderer. Deaths (stars[i].death, NaN when
// null) are pushed once. The layout worker `version` is monotonic across
// re-inits; we always consume the latest posted frame.
//
// Playback state lives in a ref (not React state) so the rAF loop never
// triggers re-renders. UI controls call back into it via the returned API and
// a small subscription so React overlays can throttle their own updates.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { Renderer, WebGLUnsupportedError } from "@/engine/renderer";
import { buildTimeline } from "@/lib/timeline/build";
import { prepare, sceneAtTime } from "@/lib/timeline/scene";
import { colorOf, type Theme } from "@/lib/colors";
import {
  createPlayback,
  play,
  pause,
  setSpeed,
  seek,
  tick,
  type PlaybackState,
} from "@/lib/playback";
import type { CommitTimeline, Timeline, SceneState, LayoutFrame } from "@/lib/types";

// Per-theme accent (rings/comets) and clear (background) colors.
const ACCENTS: Record<Theme, [number, number, number]> = {
  nebula: [0.55, 0.36, 0.96],
  ember: [0.96, 0.45, 0.2],
  mono: [0.6, 0.7, 1.0],
};
const CLEARS: Record<Theme, [number, number, number]> = {
  nebula: [0.02, 0.024, 0.06],
  ember: [0.04, 0.02, 0.02],
  mono: [0.016, 0.024, 0.04],
};

/** Deterministic 32-bit string hash → layout seed (documented, repo-stable). */
export function seedFromName(name: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * An isolated, deterministic frame renderer for video export. Built from the
 * CURRENT galaxy (live timeline + colors + the latest layout snapshot) on its
 * own offscreen canvas + Renderer at the requested resolution, so it never
 * fights the live theater for the GL context. Camera framing is FIXED to the
 * snapshot's bounds for the whole export (no auto-drift), and the "reporeel"
 * watermark is enabled. `renderFrameAt(t, dt)` samples the prepared timeline at
 * `t`, draws one deterministic frame, and returns the canvas to read back.
 */
export interface ExportFrameRenderer {
  renderFrameAt(t: number, dt: number): HTMLCanvasElement;
  readonly canvas: HTMLCanvasElement;
  dispose(): void;
}

export interface GalaxyHandle {
  /** Latest built timeline (for overlays: name, supernovas, etc.). */
  readonly timeline: Timeline;
  /** Repo identity for share links / filenames (name, owner?, source). */
  readonly repo: CommitTimeline["repo"];
  /** Read the live playback state (mutable ref target; copy if retaining). */
  getPlayback(): PlaybackState;
  play(): void;
  pause(): void;
  setSpeed(speed: number): void;
  seek(t: number): void;
  /**
   * Build an offscreen deterministic frame renderer for export at the given
   * resolution, using the galaxy's current shape (a snapshot of the live layout
   * positions, held static for every exported frame) and current theme colors.
   * Returns null if WebGL2 is unavailable on the offscreen canvas. Caller MUST
   * call .dispose() when done.
   */
  createExportRenderer(width: number, height: number): ExportFrameRenderer | null;
}

/**
 * Build the offscreen deterministic export renderer (module-level so it can be
 * unit-reasoned in isolation from the hook). Snapshots the supplied layout
 * positions and holds them static for every exported frame, so the exported
 * galaxy is exactly the theater's CURRENT shape. The camera is fixed framing the
 * snapshot's bounds (no auto-drift): we center on the bounds centroid and pick a
 * zoom that fits the bounds with margin into the export resolution.
 */
function buildExportRenderer(
  width: number,
  height: number,
  ctx: {
    prepared: ReturnType<typeof prepare>;
    colors: Float32Array;
    deaths: Float64Array;
    layout: LayoutFrame;
    theme: Theme;
  },
): ExportFrameRenderer | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  let renderer: Renderer;
  try {
    renderer = new Renderer(canvas, /* offscreen */ true);
  } catch {
    return null; // WebGL2 unavailable on the offscreen canvas
  }

  // Static snapshot of the current galaxy shape (copy so later sim ticks on the
  // live layout buffer can't mutate what we export).
  const snapshot: LayoutFrame = {
    positions: new Float32Array(ctx.layout.positions),
    version: ctx.layout.version,
  };

  const accent = ACCENTS[ctx.theme];
  const clear = CLEARS[ctx.theme];
  renderer.setAccent(accent[0], accent[1], accent[2]);
  renderer.setClearColor(clear[0], clear[1], clear[2]);
  renderer.setDeaths(ctx.deaths);
  renderer.setWatermark(true);

  // Fix the camera framing to the bounds of the snapshot positions (finite only).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const p = snapshot.positions;
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i];
    const y = p[i + 1];
    if (!isFinite(x) || !isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (isFinite(minX)) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    // zoom = device px per world unit; fit with 15% margin on the tighter axis.
    const zx = (width * 0.85) / spanX;
    const zy = (height * 0.85) / spanY;
    renderer.camera.x = cx;
    renderer.camera.y = cy;
    renderer.camera.zoom = Math.min(zx, zy);
  }
  renderer.camera.mode = "free"; // never auto-drift during export

  const renderFrameAt = (t: number, dt: number): HTMLCanvasElement => {
    const scene: SceneState = sceneAtTime(ctx.prepared, t);
    renderer.renderAt(scene, snapshot, ctx.colors, { dt, deterministic: true });
    return canvas;
  };

  return {
    canvas,
    renderFrameAt,
    dispose: () => renderer.dispose(),
  };
}

export interface GalaxyOptions {
  /** Autoplay config for the landing hero: loop the galaxy at a calm speed. */
  autoplay?: { speed: number; loop: boolean };
}

interface GalaxyResult {
  /** null until the renderer is up; carries methods + timeline once ready. */
  handle: GalaxyHandle | null;
  error: Error | null;
  fps: number;
}

export function useGalaxy(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  commitTimeline: CommitTimeline | null,
  theme: Theme,
  options?: GalaxyOptions,
): GalaxyResult {
  const [handle, setHandle] = useState<GalaxyHandle | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [fps, setFps] = useState(0);

  // Live, render-loop-owned values kept in refs to avoid per-frame React churn.
  const rendererRef = useRef<Renderer | null>(null);
  const preparedRef = useRef<ReturnType<typeof prepare> | null>(null);
  const colorsRef = useRef<Float32Array | null>(null);
  const playbackRef = useRef<PlaybackState | null>(null);
  const fpsValRef = useRef(0);
  // Latest layout frame + deaths, kept in refs so the export path can snapshot
  // the galaxy's current shape without reaching into the render loop closure.
  const layoutRef = useRef<LayoutFrame | null>(null);
  const deathsRef = useRef<Float64Array | null>(null);

  // Keep the latest theme readable inside the long-lived effect.
  const themeRef = useRef(theme);

  // ── Build pipeline + renderer + worker (per timeline/canvas) ──────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !commitTimeline) return;

    setError(null);

    const timeline = buildTimeline(commitTimeline);

    // Empty (unborn) repo: surface as an error to the page.
    if (timeline.stars.length === 0) {
      setError(new Error("This repository has no commits yet."));
      return;
    }

    const prepared = prepare(timeline);
    preparedRef.current = prepared;

    const n = timeline.stars.length;

    // Colors (rebuilt on theme change below).
    const colors = new Float32Array(n * 3);
    const buildColors = (th: Theme) => {
      for (let i = 0; i < n; i++) {
        const [r, g, b] = colorOf(timeline.stars[i].lang, th);
        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      }
    };
    buildColors(themeRef.current);
    colorsRef.current = colors;

    // Deaths (NaN = alive).
    const deaths = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const d = timeline.stars[i].death;
      deaths[i] = d === null ? NaN : d;
    }
    deathsRef.current = deaths;

    let renderer: Renderer | null = null;
    let worker: Worker | null = null;
    let tickRaf = 0;
    let disposed = false;

    try {
      renderer = new Renderer(canvas);
      rendererRef.current = renderer;
      const accent = ACCENTS[themeRef.current];
      const clear = CLEARS[themeRef.current];
      renderer.setAccent(accent[0], accent[1], accent[2]);
      renderer.setClearColor(clear[0], clear[1], clear[2]);
      renderer.setDeaths(deaths);
      renderer.camera.zoom = 0.4;

      // Reduced motion: stop auto-drift (camera stays where the user left it).
      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduce) renderer.camera.mode = "free";

      renderer.onFrame((f) => {
        fpsValRef.current = f;
      });
      renderer.onContextLost(() => {
        if (!disposed) setError(new WebGLUnsupportedError("GPU context lost — please reload."));
      });

      // Layout worker (real production path; same as /perf).
      worker = new Worker(new URL("./layout/worker.ts", import.meta.url), {
        type: "module",
      });
      let layout: LayoutFrame = { positions: new Float32Array(n * 2), version: -1 };
      layoutRef.current = layout;
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as { type: string; positions?: Float32Array; version?: number };
        if (msg.type === "frame" && msg.positions) {
          layout = { positions: msg.positions, version: msg.version ?? 0 };
          layoutRef.current = layout;
        }
      };
      worker.postMessage({
        type: "init",
        starDirs: timeline.starDirs,
        dirCount: timeline.dirs.length,
        seed: seedFromName(commitTimeline.repo.name),
      });

      // Playback clock.
      let playback = createPlayback(timeline.t0, timeline.t1);
      if (options?.autoplay) {
        playback = play(setSpeed(seek(playback, timeline.t0), options.autoplay.speed));
      }
      playbackRef.current = playback;

      // ── Per-frame loop ─────────────────────────────────────────────────
      let lastTs = performance.now();
      const loop = (ts: number) => {
        if (disposed) return;
        const wallDt = Math.min(ts - lastTs, 100);
        lastTs = ts;

        let pb = playbackRef.current!;
        pb = tick(pb, wallDt);

        // Loop the landing autoplay: when it auto-pauses at t1, seek back to t0.
        if (options?.autoplay?.loop && !pb.playing && pb.t >= timeline.t1) {
          pb = play(seek(pb, timeline.t0));
        }
        playbackRef.current = pb;

        const scene: SceneState = sceneAtTime(prepared, pb.t);
        renderer!.setScene(scene, layout, colorsRef.current!);

        // Drive layout (decoupled cadence; pause when tab hidden).
        if (!document.hidden) {
          worker!.postMessage({ type: "tick", dt: 16 });
        }

        tickRaf = requestAnimationFrame(loop);
      };

      renderer.start();
      tickRaf = requestAnimationFrame(loop);

      const api: GalaxyHandle = {
        timeline,
        repo: commitTimeline.repo,
        getPlayback: () => playbackRef.current!,
        play: () => {
          playbackRef.current = play(playbackRef.current!);
        },
        pause: () => {
          playbackRef.current = pause(playbackRef.current!);
        },
        setSpeed: (speed: number) => {
          playbackRef.current = setSpeed(playbackRef.current!, speed);
        },
        seek: (t: number) => {
          playbackRef.current = seek(playbackRef.current!, t);
        },
        createExportRenderer: (width, height) =>
          buildExportRenderer(width, height, {
            prepared,
            colors: colorsRef.current!,
            deaths: deathsRef.current!,
            layout: layoutRef.current!,
            theme: themeRef.current,
          }),
      };
      setHandle(api);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }

    return () => {
      disposed = true;
      if (tickRaf) cancelAnimationFrame(tickRaf);
      worker?.terminate();
      renderer?.dispose();
      rendererRef.current = null;
      setHandle(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, commitTimeline]);

  // ── Theme changes: rebuild colors + accent + clear (no renderer recreate) ─
  useEffect(() => {
    themeRef.current = theme;
    const renderer = rendererRef.current;
    const prepared = preparedRef.current;
    const colors = colorsRef.current;
    if (!renderer || !prepared || !colors) return;
    const stars = prepared.timeline.stars;
    for (let i = 0; i < stars.length; i++) {
      const [r, g, b] = colorOf(stars[i].lang, theme);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    const accent = ACCENTS[theme];
    const clear = CLEARS[theme];
    renderer.setAccent(accent[0], accent[1], accent[2]);
    renderer.setClearColor(clear[0], clear[1], clear[2]);
  }, [theme]);

  // ── FPS flush to React at ~4 Hz (avoid per-frame setState) ───────────────
  useEffect(() => {
    const id = window.setInterval(() => setFps(fpsValRef.current), 250);
    return () => window.clearInterval(id);
  }, []);

  return { handle, error, fps };
}
