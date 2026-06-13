// ---------------------------------------------------------------------------
// recorder.ts — client-side video export.
//
// Two layers:
//   PURE (unit-tested): planExport (frame schedule) + pickEncoder (capability
//   selection). No browser globals; deterministic; safe to test in vitest.
//
//   IMPURE (thin, not unit-tested): exportWebCodecs / exportMediaRecorder and
//   isExportSupported. These touch VideoEncoder / MediaRecorder / mp4-muxer and
//   the DOM. They are intentionally minimal wrappers around the pure plan.
//
// The caller (ExportModal, via useGalaxy) supplies a `renderFrameAt(t, dt)`
// callback that deterministically renders the galaxy at timeline-time `t` into
// an offscreen canvas and returns that canvas. The recorder samples one canvas
// per planned frame, wraps it in a VideoFrame, encodes, and muxes to MP4.
// ---------------------------------------------------------------------------

import { Muxer, ArrayBufferTarget } from "mp4-muxer";

// ── Pure: frame schedule ───────────────────────────────────────────────────

export interface ExportPlan {
  /** Number of frames to render/encode. */
  frameCount: number;
  /**
   * Timeline times (epoch ms) to sample, one per frame, linear from t0 to t1
   * inclusive. times[0] === t0 and times[last] === t1. A degenerate window
   * (t0 === t1) yields every time equal to t0.
   */
  times: number[];
}

/**
 * Plan an export: round(durationS * fps) frames, sampling the timeline window
 * [t0, t1] linearly and inclusively. The first sampled time is exactly t0 and
 * the last is exactly t1 (so the video opens on the repo's first commit and
 * ends on its last). A degenerate window collapses every sample to t0.
 */
export function planExport(
  t0: number,
  t1: number,
  durationS: number,
  fps = 30
): ExportPlan {
  const frameCount = Math.max(1, Math.round(durationS * fps));
  const times = new Array<number>(frameCount);
  if (frameCount === 1 || t0 === t1) {
    times.fill(t0);
    // Still pin the final sample to t1 when there is a real window.
    if (frameCount === 1) times[0] = t0;
  } else {
    const span = t1 - t0;
    const last = frameCount - 1;
    for (let i = 0; i < frameCount; i++) {
      times[i] = t0 + (span * i) / last;
    }
    // Pin endpoints exactly (avoid float drift at i === last).
    times[0] = t0;
    times[last] = t1;
  }
  return { frameCount, times };
}

// ── Pure: encoder selection ─────────────────────────────────────────────────

export type EncoderKind = "webcodecs" | "mediarecorder" | "none";

/**
 * Choose an encoder given the environment's capabilities. WebCodecs is
 * preferred (it produces real MP4/H.264 from deterministic frames); MediaRecorder
 * is the realtime WebM fallback; "none" when neither exists.
 */
export function pickEncoder(env: {
  hasVideoEncoder: boolean;
  hasMediaRecorder: boolean;
}): EncoderKind {
  if (env.hasVideoEncoder) return "webcodecs";
  if (env.hasMediaRecorder) return "mediarecorder";
  return "none";
}

// ── Impure: capability probe ────────────────────────────────────────────────

/** Detect export capabilities in the current browser. */
export function isExportSupported(): { webcodecs: boolean; mediarecorder: boolean } {
  const webcodecs =
    typeof window !== "undefined" &&
    typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder !==
      "undefined" &&
    typeof (window as unknown as { VideoFrame?: unknown }).VideoFrame !==
      "undefined";
  const mediarecorder =
    typeof window !== "undefined" &&
    typeof (window as unknown as { MediaRecorder?: unknown }).MediaRecorder !==
      "undefined";
  return { webcodecs, mediarecorder };
}

// ── Impure: shared options ──────────────────────────────────────────────────

export interface ExportOpts {
  /** Timeline window start (epoch ms). */
  t0: number;
  /** Timeline window end (epoch ms). */
  t1: number;
  /** Target video duration in seconds. */
  durationS: number;
  /** Frames per second. */
  fps?: number;
  width: number;
  height: number;
  /** Used for the download filename: reporeel-{repoName}.{ext}. */
  repoName: string;
  /**
   * Deterministically render the galaxy at timeline-time `t` (advancing effects
   * by `dt` ms) and return the canvas holding that frame. Called once per
   * planned frame, in order.
   */
  renderFrameAt: (t: number, dt: number) => HTMLCanvasElement;
  /** Progress 0..1, called after each encoded frame. */
  onProgress?: (p: number) => void;
  /** Polled per frame; when it returns true the export aborts cleanly. */
  shouldAbort?: () => boolean;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ── Impure: WebCodecs MP4 export ────────────────────────────────────────────

/**
 * Export to MP4 via WebCodecs (H.264 baseline) + mp4-muxer. Renders each
 * planned frame deterministically, wraps it in a VideoFrame with a frame-index
 * timestamp, encodes, and muxes to an in-memory MP4 that is downloaded.
 *
 * Returns true if a file was produced, false if aborted.
 */
export async function exportWebCodecs(opts: ExportOpts): Promise<boolean> {
  const fps = opts.fps ?? 30;
  const plan = planExport(opts.t0, opts.t1, opts.durationS, fps);
  const frameDt = 1e6 / fps; // microseconds per frame
  const dtMs = 1000 / fps;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: "avc",
      width: opts.width,
      height: opts.height,
      frameRate: fps,
    },
    fastStart: "in-memory",
  });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e instanceof Error ? e : new Error(String(e));
    },
  });

  encoder.configure({
    codec: "avc1.42001f", // H.264 baseline, level 3.1
    width: opts.width,
    height: opts.height,
    bitrate: 8_000_000,
    framerate: fps,
  });

  let aborted = false;
  for (let i = 0; i < plan.frameCount; i++) {
    if (opts.shouldAbort?.()) {
      aborted = true;
      break;
    }
    if (encoderError) throw encoderError;

    const canvas = opts.renderFrameAt(plan.times[i], dtMs);
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(i * frameDt),
      duration: Math.round(frameDt),
    });
    // Keyframe every 2 seconds (and on the first frame).
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();

    opts.onProgress?.((i + 1) / plan.frameCount);

    // Yield periodically so the encode queue drains and the UI can update.
    if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
  }

  if (aborted) {
    // Best-effort teardown; do not finalize/download a partial file.
    try {
      encoder.close();
    } catch {
      /* already closed */
    }
    return false;
  }

  await encoder.flush();
  if (encoderError) throw encoderError;
  encoder.close();
  muxer.finalize();

  const { buffer } = muxer.target as ArrayBufferTarget;
  const blob = new Blob([buffer], { type: "video/mp4" });
  triggerDownload(blob, `reporeel-${safeName(opts.repoName)}.mp4`);
  return true;
}

// ── Impure: MediaRecorder WebM fallback ─────────────────────────────────────

/**
 * Realtime fallback when WebCodecs is unavailable. Records the supplied canvas
 * stream while stepping the planned frames in realtime (one frame per
 * 1000/fps ms of wall time), producing a WebM (VP9 if supported) download.
 *
 * Less precise than WebCodecs (depends on wall-clock pacing) but works in any
 * MediaRecorder-capable browser. Returns true if a file was produced.
 */
export async function exportMediaRecorder(opts: ExportOpts): Promise<boolean> {
  const fps = opts.fps ?? 30;
  const plan = planExport(opts.t0, opts.t1, opts.durationS, fps);
  const dtMs = 1000 / fps;

  // Render the first frame so the canvas has content, then capture its stream.
  const canvas = opts.renderFrameAt(plan.times[0], dtMs);
  const stream = canvas.captureStream(fps);

  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start();

  let aborted = false;
  for (let i = 0; i < plan.frameCount; i++) {
    if (opts.shouldAbort?.()) {
      aborted = true;
      break;
    }
    opts.renderFrameAt(plan.times[i], dtMs);
    opts.onProgress?.((i + 1) / plan.frameCount);
    // Pace in realtime so the captured stream has one frame per step.
    await new Promise((r) => setTimeout(r, dtMs));
  }

  recorder.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());

  if (aborted) return false;

  const blob = new Blob(chunks, { type: "video/webm" });
  triggerDownload(blob, `reporeel-${safeName(opts.repoName)}.webm`);
  return true;
}
