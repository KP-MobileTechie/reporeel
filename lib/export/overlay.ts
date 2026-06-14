// ---------------------------------------------------------------------------
// export/overlay.ts — 2D compositing layer that burns the AI Coordinator's
// narration into the exported video.
//
// The WebGL renderer only paints the galaxy; DOM captions never reach the
// encoder. So the exporter draws each GL frame onto a 2D canvas and then this
// module paints, on top: an intro TITLE CARD (project name + headline, fading
// in/out over the opening seconds) and a lower-third NARRATION CAPTION for the
// active beat. Returning that 2D canvas to the recorder gets text into the MP4.
//
// `wrapText` is pure (no canvas) and unit-tested; the draw helpers are thin
// Canvas2D wrappers.
// ---------------------------------------------------------------------------

import type { NarrationBeat } from "@/lib/insights/types";

/** A minimal text-measuring surface (CanvasRenderingContext2D satisfies it). */
export interface TextMeasurer {
  measureText(s: string): { width: number };
}

/**
 * Greedy word-wrap `text` into lines no wider than `maxWidth` (using the
 * measurer's current font). Words longer than maxWidth occupy their own line
 * rather than being split mid-word. Pure: depends only on measureText.
 */
export function wrapText(ctx: TextMeasurer, text: string, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (words.length === 0 || (words.length === 1 && words[0] === "")) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width <= maxWidth || !line) {
      line = trial;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Opacity (0..1) of the intro title card at export-progress `p` (0..1). The
 * card fades in over the first ~6% of the reel, holds, then fades out by ~22%.
 * Returns 0 outside that window so most of the video is uncovered.
 */
export function titleCardOpacity(p: number): number {
  if (p < 0 || p > 0.24) return 0;
  if (p < 0.04) return p / 0.04; // fade in
  if (p < 0.16) return 1; // hold
  if (p < 0.24) return 1 - (p - 0.16) / 0.08; // fade out
  return 0;
}

export interface OverlayOpts {
  width: number;
  height: number;
  /** Active narration beat (null hides the caption). */
  beat: NarrationBeat | null;
  /** Project name + headline for the intro card. */
  title: string;
  headline: string;
  /** Export progress 0..1, drives the intro card fade. */
  progress: number;
}

/**
 * Paint the narration overlay onto a 2D context. Draws the caption lower-third
 * whenever there's an active beat, and the intro title card during the opening.
 * Scales typography to the export height so 720p and 1080p both read well.
 */
export function drawOverlay(ctx: CanvasRenderingContext2D, o: OverlayOpts): void {
  const { width: W, height: H } = o;
  const scale = H / 1080;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // ── Lower-third caption ─────────────────────────────────────────────────
  if (o.beat) {
    const fontPx = Math.round(34 * scale);
    ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const maxW = W * 0.8;
    const lines = wrapText(ctx, o.beat.text, maxW);
    const lineH = fontPx * 1.3;
    const blockH = lines.length * lineH;
    const padY = 28 * scale;
    const boxTop = H - blockH - padY * 2 - 90 * scale;
    const boxH = blockH + padY * 2;

    // Backing panel for legibility.
    ctx.fillStyle = "rgba(6, 8, 18, 0.55)";
    roundRect(ctx, W * 0.08, boxTop, W * 0.84, boxH, 18 * scale);
    ctx.fill();

    // Kind chip color.
    ctx.fillStyle = beatColor(o.beat.kind);
    const cy = boxTop + padY + lineH / 2;
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    lines.forEach((ln, i) => {
      ctx.fillText(ln, W / 2, cy + i * lineH);
    });

    // Small accent underline.
    ctx.fillStyle = beatColor(o.beat.kind);
    ctx.fillRect(W / 2 - 28 * scale, boxTop + boxH - 8 * scale, 56 * scale, 4 * scale);
  }

  // ── Intro title card ──────────────────────────────────────────────────────
  const alpha = titleCardOpacity(o.progress);
  if (alpha > 0) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(4, 5, 14, 0.45)";
    ctx.fillRect(0, H * 0.32, W, H * 0.34);

    const titlePx = Math.round(72 * scale);
    ctx.font = `700 ${titlePx}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.98)";
    ctx.fillText(o.title, W / 2, H * 0.44);

    const subPx = Math.round(30 * scale);
    ctx.font = `400 ${subPx}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "rgba(180,190,220,0.95)";
    const subLines = wrapText(ctx, o.headline, W * 0.7);
    subLines.forEach((ln, i) => ctx.fillText(ln, W / 2, H * 0.52 + i * subPx * 1.3));
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function beatColor(kind: NarrationBeat["kind"]): string {
  switch (kind) {
    case "intro":
      return "rgba(140, 110, 245, 0.95)";
    case "era":
      return "rgba(90, 170, 255, 0.95)";
    case "milestone":
      return "rgba(250, 190, 90, 0.95)";
    case "event":
      return "rgba(110, 230, 160, 0.95)";
    case "outro":
      return "rgba(200, 200, 220, 0.95)";
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}
