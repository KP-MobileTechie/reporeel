import { describe, it, expect } from "vitest";
import {
  planExport,
  pickEncoder,
  codecForHeight,
  bitrateForHeight,
} from "@/lib/export/recorder";

describe("planExport", () => {
  it("produces exact frame counts at 30fps", () => {
    expect(planExport(0, 1000, 30).frameCount).toBe(900);
    expect(planExport(0, 1000, 60).frameCount).toBe(1800);
    expect(planExport(0, 1000, 90).frameCount).toBe(2700);
  });

  it("honors a custom fps", () => {
    expect(planExport(0, 1000, 2, 60).frameCount).toBe(120);
    expect(planExport(0, 1000, 1, 30).frameCount).toBe(30);
  });

  it("rounds non-integer frame counts", () => {
    // 1.5s * 30fps = 45
    expect(planExport(0, 100, 1.5, 30).frameCount).toBe(45);
    // 0.5s * 30 = 15
    expect(planExport(0, 100, 0.5, 30).frameCount).toBe(15);
  });

  it("samples linearly with exact inclusive endpoints", () => {
    const { times } = planExport(1000, 2000, 1, 5); // 5 frames
    expect(times.length).toBe(5);
    expect(times[0]).toBe(1000);
    expect(times[times.length - 1]).toBe(2000);
    // Linear interior samples.
    expect(times[1]).toBeCloseTo(1250, 6);
    expect(times[2]).toBeCloseTo(1500, 6);
    expect(times[3]).toBeCloseTo(1750, 6);
  });

  it("pins both endpoints exactly even with many frames", () => {
    const { times, frameCount } = planExport(0, 7919, 3, 30); // 90 frames over an odd span
    expect(times[0]).toBe(0);
    expect(times[frameCount - 1]).toBe(7919);
  });

  it("collapses a degenerate window to all-t0", () => {
    const { times, frameCount } = planExport(500, 500, 2, 30);
    expect(frameCount).toBe(60);
    expect(times.every((t) => t === 500)).toBe(true);
  });

  it("handles a single-frame plan", () => {
    const { times, frameCount } = planExport(10, 90, 0.01, 30); // round(0.3) = 0 -> clamped to 1
    expect(frameCount).toBe(1);
    expect(times).toEqual([10]);
  });
});

describe("pickEncoder", () => {
  it("prefers webcodecs when available", () => {
    expect(pickEncoder({ hasVideoEncoder: true, hasMediaRecorder: true })).toBe("webcodecs");
    expect(pickEncoder({ hasVideoEncoder: true, hasMediaRecorder: false })).toBe("webcodecs");
  });

  it("falls back to mediarecorder when no webcodecs", () => {
    expect(pickEncoder({ hasVideoEncoder: false, hasMediaRecorder: true })).toBe("mediarecorder");
  });

  it("returns none when nothing is available", () => {
    expect(pickEncoder({ hasVideoEncoder: false, hasMediaRecorder: false })).toBe("none");
  });
});

describe("codecForHeight", () => {
  it("uses Baseline L3.1 (42001f) for <=720p", () => {
    expect(codecForHeight(720)).toBe("avc1.42001f");
    expect(codecForHeight(480)).toBe("avc1.42001f");
  });

  it("uses Baseline L4.0 (420028) for 1080p and above", () => {
    expect(codecForHeight(1080)).toBe("avc1.420028");
    expect(codecForHeight(721)).toBe("avc1.420028");
    expect(codecForHeight(2160)).toBe("avc1.420028");
  });
});

describe("bitrateForHeight", () => {
  it("scales bitrate with resolution", () => {
    expect(bitrateForHeight(720)).toBe(8_000_000);
    expect(bitrateForHeight(1080)).toBe(14_000_000);
  });
});
