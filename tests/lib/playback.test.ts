import { describe, it, expect } from "vitest";
import {
  BASE_DURATION_MS,
  MIN_SPEED,
  MAX_SPEED,
  createPlayback,
  play,
  pause,
  setSpeed,
  seek,
  tick,
} from "@/lib/playback";

describe("createPlayback", () => {
  it("starts paused at t0, speed 1", () => {
    const s = createPlayback(100, 200);
    expect(s.t).toBe(100);
    expect(s.playing).toBe(false);
    expect(s.speed).toBe(MIN_SPEED);
    expect(s.t0).toBe(100);
    expect(s.t1).toBe(200);
  });

  it("collapses an inverted range to a single instant at t0", () => {
    const s = createPlayback(500, 100);
    expect(s.t0).toBe(500);
    expect(s.t1).toBe(500);
    expect(s.t).toBe(500);
  });
});

describe("tick advance math", () => {
  it("advances exactly: 1s wall at speed 1 over a BASE-scaled span", () => {
    // span = 90_000_000; 1000ms wall * 1 * span / 90_000 = 1_000_000
    const s = play(createPlayback(0, 90_000_000));
    const next = tick(s, 1000);
    expect(next.t).toBe(1_000_000);
    expect(next.playing).toBe(true);
  });

  it("scales linearly with speed", () => {
    const s = setSpeed(play(createPlayback(0, 90_000_000)), 10);
    expect(tick(s, 1000).t).toBe(10_000_000);
  });

  it("a full BASE_DURATION_MS of wall time at speed 1 reaches t1", () => {
    const s = play(createPlayback(0, 90_000_000));
    const next = tick(s, BASE_DURATION_MS);
    expect(next.t).toBe(90_000_000);
  });
});

describe("tick clamp + autopause", () => {
  it("clamps at t1 and auto-pauses there", () => {
    const s = { ...play(createPlayback(0, 1000)), t: 999 };
    const next = tick(s, BASE_DURATION_MS); // huge advance
    expect(next.t).toBe(1000);
    expect(next.playing).toBe(false);
  });

  it("auto-pauses exactly when landing on t1", () => {
    const s = play(createPlayback(0, 90_000_000));
    const next = tick(s, BASE_DURATION_MS);
    expect(next.playing).toBe(false);
  });
});

describe("tick when paused", () => {
  it("returns the input state unchanged (same reference)", () => {
    const s = createPlayback(0, 1000);
    const next = tick(s, 500);
    expect(next).toBe(s);
    expect(next.t).toBe(0);
  });
});

describe("seek", () => {
  it("clamps below t0", () => {
    expect(seek(createPlayback(100, 200), 50).t).toBe(100);
  });
  it("clamps above t1", () => {
    expect(seek(createPlayback(100, 200), 999).t).toBe(200);
  });
  it("sets an in-range value", () => {
    expect(seek(createPlayback(100, 200), 150).t).toBe(150);
  });
});

describe("setSpeed clamp", () => {
  it("clamps below MIN_SPEED", () => {
    expect(setSpeed(createPlayback(0, 1), 0).speed).toBe(MIN_SPEED);
    expect(setSpeed(createPlayback(0, 1), -5).speed).toBe(MIN_SPEED);
  });
  it("clamps above MAX_SPEED", () => {
    expect(setSpeed(createPlayback(0, 1), 9999).speed).toBe(MAX_SPEED);
  });
  it("keeps an in-range value", () => {
    expect(setSpeed(createPlayback(0, 1), 25).speed).toBe(25);
  });
});

describe("degenerate range", () => {
  it("tick is a no-op at t0===t1", () => {
    const s = play(createPlayback(500, 500));
    const next = tick(s, 1000);
    expect(next).toBe(s);
    expect(next.t).toBe(500);
  });
});

describe("immutability", () => {
  it("play/pause/setSpeed/seek/tick do not mutate input", () => {
    const base = play(createPlayback(0, 1000));
    const snapshot = { ...base };

    pause(base);
    setSpeed(base, 50);
    seek(base, 500);
    tick(base, 100);

    expect(base).toEqual(snapshot);
  });

  it("tick returns a new object when it advances", () => {
    const s = play(createPlayback(0, 90_000_000));
    const next = tick(s, 1000);
    expect(next).not.toBe(s);
  });
});

describe("speed bounds constants", () => {
  it("MIN_SPEED is 1 and MAX_SPEED is 100", () => {
    expect(MIN_SPEED).toBe(1);
    expect(MAX_SPEED).toBe(100);
  });
});
