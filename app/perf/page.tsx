"use client";

/**
 * /perf — synthetic stress harness for the WebGL2 renderer.
 *
 * Generates a deterministic 10,000-star galaxy across 120 directories and
 * drives layout through the REAL layout worker (init + per-frame tick),
 * exactly as production will. Each frame the latest worker frame is fed to
 * the renderer via setScene, a deterministic subset of stars is pulsed to
 * exercise the GPU pulse path, and a HUD reports live FPS + dropped frames.
 */

import { useEffect, useRef, useState } from "react";
import { Renderer, WebGLUnsupportedError } from "@/engine/renderer";
import { mulberry32 } from "@/lib/layout/prng";
import { colorOf } from "@/lib/colors";
import type { SceneState, LayoutFrame } from "@/lib/types";

const STAR_COUNT = 10_000;
const DIR_COUNT = 120;
const LANGS = [
  "ts",
  "js",
  "css",
  "md",
  "config",
  "py",
  "rs",
  "go",
  "html",
  "other",
];

export default function PerfPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"starting" | "running" | "error">(
    "starting"
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [fps, setFps] = useState(0);
  const [dropped, setDropped] = useState(0); // slow frames (>25ms) in the last second
  const [paused, setPaused] = useState(false);
  // Auto-enable stress when loaded with ?stress=1 (used by headless verification
  // so a single-shot render exercises the effect passes).
  const [stress, setStress] = useState(
    typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("stress") === "1"
  );

  // Live ref so the pause button toggles the running tick loop.
  const pausedRef = useRef(false);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Live ref so the stress toggle drives effect injection in the tick loop.
  const stressRef = useRef(false);
  useEffect(() => {
    stressRef.current = stress;
  }, [stress]);

  // Renderer-side values held in refs; flushed to React state at ~4 Hz to
  // avoid flooding the reconciler on every rAF callback (~60 Hz).
  const fpsRef = useRef(0);
  const droppedRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: Renderer | null = null;
    let worker: Worker | null = null;
    let tickRaf = 0;
    let hudInterval = 0;
    let disposed = false;

    // Dropped-frame tracking (frames slower than 25ms in the last second).
    const frameTimes: number[] = [];
    let lastFrameStamp = performance.now();

    try {
      // ── Synthetic galaxy data ──────────────────────────────────────────
      const rand = mulberry32(7);
      const starDirs = new Array<number>(STAR_COUNT);
      for (let i = 0; i < STAR_COUNT; i++) {
        starDirs[i] = Math.floor(rand() * DIR_COUNT);
      }

      // Static sizes (1..4), static colors, animated pulses.
      const sizes = new Float32Array(STAR_COUNT);
      const pulses = new Float32Array(STAR_COUNT);
      const colors = new Float32Array(STAR_COUNT * 3);
      for (let i = 0; i < STAR_COUNT; i++) {
        sizes[i] = 1 + rand() * 3;
        const lang = LANGS[i % LANGS.length];
        const [r, g, b] = colorOf(lang, "nebula");
        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      }

      // Minimal SceneState — only sizes/pulses are consumed by the renderer.
      const scene: SceneState = {
        t: 0,
        aliveStarIds: [],
        sizes,
        pulses,
        activeSupernovas: [],
        cometPositions: [],
      };

      // ── Stress-mode synthetic effect data (synthetic only; see toggle) ────
      // Precompute a handful of random star clusters for supernovas, and a set
      // of random from/to star pairs for comets. A star-id-indexed deaths array
      // (Float64Array, NaN = alive) is mutated each frame so ~50 stars "die"
      // every 5s on a cycle and then revive — purely to exercise the collapse
      // pass; real timelines supply genuine death times.
      const STRESS_CLUSTERS = Array.from({ length: 8 }, () => {
        const base = Math.floor(rand() * (STAR_COUNT - 12));
        return Array.from({ length: 8 }, (_, k) => base + k);
      });
      const STRESS_COMETS = Array.from({ length: 20 }, () => ({
        author: `author-${Math.floor(rand() * 20)}`,
        fromStar: Math.floor(rand() * STAR_COUNT),
        toStar: Math.floor(rand() * STAR_COUNT),
      }));
      const deaths = new Float64Array(STAR_COUNT).fill(NaN);
      let deathsApplied = false;
      const t0 = performance.now();

      // Latest layout frame from the worker (positions, x/y per star id).
      let layout: LayoutFrame = {
        positions: new Float32Array(STAR_COUNT * 2),
        version: -1,
      };

      // ── Renderer ────────────────────────────────────────────────────────
      renderer = new Renderer(canvas);
      renderer.setClearColor(0.02, 0.02, 0.06);
      renderer.setAccent(0.55, 0.36, 0.96);
      renderer.setDeaths(deaths);
      // Start zoomed out enough to see the whole spiral (SPIRAL_STEP*sqrt(120)).
      renderer.camera.zoom = 0.18;
      renderer.onFrame((f) => {
        const now = performance.now();
        const delta = now - lastFrameStamp;
        lastFrameStamp = now;
        frameTimes.push(now);
        // Keep only timestamps from the last second.
        while (frameTimes.length && now - frameTimes[0] > 1000) {
          frameTimes.shift();
        }
        // Dropped = frames with a gap >25ms, counted within the last second.
        // Count by looking at consecutive pairs in the sliding window.
        let slowInWindow = 0;
        for (let i = 1; i < frameTimes.length; i++) {
          if (frameTimes[i] - frameTimes[i - 1] > 25) slowInWindow++;
        }
        // Also count the gap from the previous frame into the window.
        if (delta > 25) slowInWindow++;
        fpsRef.current = f;
        droppedRef.current = slowInWindow;
      });

      // ── Layout worker (real production path) ─────────────────────────────
      worker = new Worker(new URL("../../lib/layout/worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as { type: string; positions?: Float32Array; version?: number };
        if (msg.type === "frame" && msg.positions) {
          layout = { positions: msg.positions, version: msg.version ?? 0 };
        }
      };
      worker.postMessage({
        type: "init",
        starDirs,
        dirCount: DIR_COUNT,
        seed: 7,
      });

      // ── Tick + scene-feed loop (drives the worker once per animation frame) ─
      const tick = () => {
        if (disposed) return;
        if (!pausedRef.current) {
          // Worker is decoupled from the draw cadence: ticks are fire-and-forget
          // (no backpressure); the latest worker frame wins if it arrives late.
          worker?.postMessage({ type: "tick", dt: 16 });
        }
        // Animate a deterministic subset of pulses (every 50th star).
        // Main-thread serialization makes this in-place mutation safe: tick
        // and renderer.frame() never execute concurrently on the same thread.
        const t = performance.now();
        for (let i = 0; i < STAR_COUNT; i += 50) {
          pulses[i] = (Math.sin(t * 0.003 + i) + 1) / 2;
        }

        // ── Stress effects ────────────────────────────────────────────────
        const elapsed = t - t0;
        // scene.t must share a domain with the deaths array (both ms since t0).
        scene.t = elapsed;
        if (stressRef.current) {
          // One supernova per second, cycling through clusters; magnitude 0.9.
          const sec = Math.floor(elapsed / 1000);
          const cluster = STRESS_CLUSTERS[sec % STRESS_CLUSTERS.length];
          const age = (elapsed % 1000) / 1000; // 0..1 over the active second
          scene.activeSupernovas = [{ starIds: cluster, age, magnitude: 0.9 }];

          // 20 comets; progress cycles 0→1 every 2s.
          const progress = (elapsed % 2000) / 2000;
          scene.cometPositions = STRESS_COMETS.map((c) => ({
            author: c.author,
            fromStar: c.fromStar,
            toStar: c.toStar,
            progress,
          }));

          // ~50 stars die every 5s on a cycle, then revive on the next cycle.
          const cyclePhase = Math.floor(elapsed / 5000) % 2;
          if (cyclePhase === 1 && !deathsApplied) {
            const start = (Math.floor(elapsed / 5000) * 37) % (STAR_COUNT - 50);
            for (let i = 0; i < 50; i++) deaths[start + i] = elapsed; // die now
            deathsApplied = true;
          } else if (cyclePhase === 0 && deathsApplied) {
            deaths.fill(NaN); // revive all
            deathsApplied = false;
          }
        } else {
          scene.activeSupernovas = [];
          scene.cometPositions = [];
          if (deathsApplied) {
            deaths.fill(NaN);
            deathsApplied = false;
          }
        }

        // Feed the latest data to the renderer.
        renderer?.setScene(scene, layout, colors);
        tickRaf = requestAnimationFrame(tick);
      };

      renderer.start();
      tickRaf = requestAnimationFrame(tick);

      // Flush renderer-side metrics to React state at ~4 Hz (250 ms interval)
      // to avoid reconciler churn on every rAF tick (~60 Hz).
      hudInterval = window.setInterval(() => {
        setFps(fpsRef.current);
        setDropped(droppedRef.current);
      }, 250);

      setStatus("running");
    } catch (err) {
      if (err instanceof WebGLUnsupportedError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
      setStatus("error");
    }

    return () => {
      disposed = true;
      if (tickRaf) cancelAnimationFrame(tickRaf);
      window.clearInterval(hudInterval);
      worker?.terminate();
      renderer?.dispose();
    };
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />

      {status === "starting" && (
        <div className="absolute inset-0 flex items-center justify-center text-fg-dim">
          starting…
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-red-300">
          WebGL renderer unavailable: {errorMsg}
        </div>
      )}

      {status === "running" && (
        <div className="absolute left-4 top-4 select-none rounded-lg bg-black/60 px-4 py-3 font-mono text-sm text-white backdrop-blur">
          <div>
            FPS: <span className="tabular-nums">{fps.toFixed(1)}</span>
          </div>
          <div>
            Stars: <span className="tabular-nums">{STAR_COUNT.toLocaleString()}</span>
          </div>
          <div>
            Slow (&gt;25ms/last 1s):{" "}
            <span className={dropped > 0 ? "text-amber-400" : ""}>{dropped}</span>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              className="rounded bg-white/10 px-3 py-1 hover:bg-white/20"
            >
              {paused ? "Resume" : "Pause"} ticks
            </button>
            <button
              type="button"
              onClick={() => setStress((s) => !s)}
              className={`rounded px-3 py-1 ${
                stress ? "bg-violet-500/40 hover:bg-violet-500/50" : "bg-white/10 hover:bg-white/20"
              }`}
            >
              Stress {stress ? "on" : "off"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
