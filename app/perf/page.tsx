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
  const [dropped, setDropped] = useState(0);
  const [paused, setPaused] = useState(false);

  // Live ref so the pause button toggles the running tick loop.
  const pausedRef = useRef(false);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: Renderer | null = null;
    let worker: Worker | null = null;
    let tickRaf = 0;
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

      // Latest layout frame from the worker (positions, x/y per star id).
      let layout: LayoutFrame = {
        positions: new Float32Array(STAR_COUNT * 2),
        version: -1,
      };

      // ── Renderer ────────────────────────────────────────────────────────
      renderer = new Renderer(canvas);
      renderer.setClearColor(0.02, 0.02, 0.06);
      // Start zoomed out enough to see the whole spiral (SPIRAL_STEP*sqrt(120)).
      renderer.camera.zoom = 0.18;
      renderer.onFrame((f) => {
        const now = performance.now();
        const delta = now - lastFrameStamp;
        lastFrameStamp = now;
        frameTimes.push(now);
        // Keep only the last second of frames; count those >25ms gaps.
        while (frameTimes.length && now - frameTimes[0] > 1000) {
          frameTimes.shift();
        }
        if (delta > 25) setDropped((d) => d + 1);
        setFps(f);
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
          worker?.postMessage({ type: "tick", dt: 16 });
        }
        // Animate a deterministic subset of pulses (every 50th star).
        const t = performance.now();
        for (let i = 0; i < STAR_COUNT; i += 50) {
          pulses[i] = (Math.sin(t * 0.003 + i) + 1) / 2;
        }
        // Feed the latest data to the renderer.
        renderer?.setScene(scene, layout, colors);
        tickRaf = requestAnimationFrame(tick);
      };

      renderer.start();
      tickRaf = requestAnimationFrame(tick);
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
            Dropped (&gt;25ms):{" "}
            <span className={dropped > 0 ? "text-amber-400" : ""}>{dropped}</span>
          </div>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="mt-2 rounded bg-white/10 px-3 py-1 hover:bg-white/20"
          >
            {paused ? "Resume" : "Pause"} ticks
          </button>
        </div>
      )}
    </div>
  );
}
