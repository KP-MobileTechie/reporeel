"use client";

// ---------------------------------------------------------------------------
// ExportModal — client-side video export + share link.
//
// Renders duration/resolution choices, a Copy-share-link control, and an Export
// button driving the recorder. Export uses the galaxy's deterministic offscreen
// renderer (handle.createExportRenderer) at the chosen resolution and feeds each
// planned frame to WebCodecs (MP4) or, when unavailable, MediaRecorder (WebM).
//
// Live playback is paused for the duration of the export. The offscreen export
// renderer has its own GL context, so it never contends with the theater canvas.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import type { GalaxyHandle } from "@/lib/useGalaxy";
import {
  isExportSupported,
  pickEncoder,
  exportWebCodecs,
  exportMediaRecorder,
  type ExportOpts,
} from "@/lib/export/recorder";

const DURATIONS = [30, 60, 90] as const;
interface Resolution {
  label: string;
  w: number;
  h: number;
}
const RESOLUTIONS: Resolution[] = [
  { label: "720p", w: 1280, h: 720 },
  { label: "1080p", w: 1920, h: 1080 },
];

type Phase = "idle" | "exporting" | "done" | "aborted" | "error";

export function ExportModal({
  handle,
  repoName,
  demoId,
  onClose,
}: {
  handle: GalaxyHandle;
  repoName: string;
  demoId: string | null;
  onClose: () => void;
}) {
  const [durationS, setDurationS] = useState<number>(30);
  const [res, setRes] = useState<Resolution>(RESOLUTIONS[0]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef(false);

  const support = isExportSupported();
  const encoder = pickEncoder({
    hasVideoEncoder: support.webcodecs,
    hasMediaRecorder: support.mediarecorder,
  });

  const { repo, timeline } = handle;

  // ── Share link ────────────────────────────────────────────────────────────
  // github -> ?repo=owner/name ; demo -> ?demo=id ; local -> not shareable.
  let shareUrl: string | null = null;
  let shareDisabledReason: string | null = null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  if (repo.source === "github" && repo.owner) {
    shareUrl = `${origin}/?repo=${repo.owner}/${repo.name}`;
  } else if (repo.source === "demo" && demoId) {
    shareUrl = `${origin}/?demo=${demoId}`;
  } else {
    shareDisabledReason = "local repos can't be shared (they never leave your browser)";
  }

  const copyShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  // Reset abort flag when closing.
  useEffect(() => {
    return () => {
      abortRef.current = true;
    };
  }, []);

  const runExport = async () => {
    if (encoder === "none") return;
    abortRef.current = false;
    setPhase("exporting");
    setProgress(0);
    setErrorMsg("");

    // Pause live playback so it doesn't compete for CPU during the export.
    const wasPlaying = handle.getPlayback().playing;
    handle.pause();

    const exportRenderer = handle.createExportRenderer(res.w, res.h);
    if (!exportRenderer) {
      setPhase("error");
      setErrorMsg("Couldn't create an export canvas (WebGL2 unavailable).");
      if (wasPlaying) handle.play();
      return;
    }

    const opts: ExportOpts = {
      t0: timeline.t0,
      t1: timeline.t1,
      durationS,
      fps: 30,
      width: res.w,
      height: res.h,
      repoName,
      renderFrameAt: exportRenderer.renderFrameAt,
      onProgress: setProgress,
      shouldAbort: () => abortRef.current,
    };

    try {
      const ok =
        encoder === "webcodecs"
          ? await exportWebCodecs(opts)
          : await exportMediaRecorder(opts);
      setPhase(ok ? "done" : "aborted");
    } catch (err) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      exportRenderer.dispose();
      if (wasPlaying) handle.play();
    }
  };

  const cancel = () => {
    abortRef.current = true;
  };

  const exporting = phase === "exporting";

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Export video"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-fg shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Export video</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-fg-dim hover:text-fg"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Duration */}
        <fieldset className="mt-5" disabled={exporting}>
          <legend className="text-sm text-fg-dim">Duration</legend>
          <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Duration">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={durationS === d}
                onClick={() => setDurationS(d)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                  durationS === d
                    ? "border-accent bg-accent/15 text-fg"
                    : "border-border text-fg-dim hover:border-accent/60"
                }`}
              >
                {d}s
              </button>
            ))}
          </div>
        </fieldset>

        {/* Resolution */}
        <fieldset className="mt-4" disabled={exporting}>
          <legend className="text-sm text-fg-dim">Resolution</legend>
          <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Resolution">
            {RESOLUTIONS.map((r) => (
              <button
                key={r.label}
                type="button"
                role="radio"
                aria-checked={res.label === r.label}
                onClick={() => setRes(r)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                  res.label === r.label
                    ? "border-accent bg-accent/15 text-fg"
                    : "border-border text-fg-dim hover:border-accent/60"
                }`}
              >
                {r.label} ({r.w}×{r.h})
              </button>
            ))}
          </div>
        </fieldset>

        {/* Encoder availability note */}
        {encoder === "mediarecorder" && (
          <p className="mt-4 rounded-lg bg-black/30 p-2 text-xs text-fg-dim">
            MP4 export is unavailable in this browser; the video will be exported
            as WebM.
          </p>
        )}
        {encoder === "none" && (
          <p className="mt-4 rounded-lg bg-black/30 p-2 text-xs text-fg-dim">
            Your browser can&apos;t export video; try Chrome, or screen-record the
            tab.
          </p>
        )}

        {/* Progress */}
        {(exporting || phase === "done") && (
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/40">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${Math.round((phase === "done" ? 1 : progress) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-fg-dim">
              {phase === "done"
                ? "Done — check your downloads."
                : `Rendering… ${Math.round(progress * 100)}%`}
            </p>
          </div>
        )}
        {phase === "aborted" && (
          <p className="mt-4 text-xs text-fg-dim">Export cancelled.</p>
        )}
        {phase === "error" && (
          <p className="mt-4 text-xs text-red-400">{errorMsg || "Export failed."}</p>
        )}

        {/* Actions */}
        <div className="mt-6 flex items-center gap-2">
          {exporting ? (
            <button
              type="button"
              onClick={cancel}
              className="rounded-lg border border-border px-4 py-2 text-sm text-fg hover:border-accent"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={runExport}
              disabled={encoder === "none"}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {phase === "done" ? "Export again" : "Export"}
            </button>
          )}

          {/* Share link */}
          <div className="ml-auto">
            <button
              type="button"
              onClick={copyShare}
              disabled={!shareUrl}
              title={shareDisabledReason ?? shareUrl ?? ""}
              className="rounded-lg border border-border px-3 py-2 text-sm text-fg-dim hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copied ? "Link copied" : "Copy share link"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
