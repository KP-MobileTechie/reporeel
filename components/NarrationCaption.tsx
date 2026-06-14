"use client";

// ---------------------------------------------------------------------------
// NarrationCaption — the live, lower-third caption from the AI Coordinator.
// Given the narration track and the current scrubber time, it shows the active
// beat with a kind-colored accent. Mirrors the styling that export/overlay.ts
// burns into the video, so the on-screen and exported captions match.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { activeBeat } from "@/lib/insights/narration";
import type { NarrationBeat } from "@/lib/insights/types";

const KIND_COLOR: Record<NarrationBeat["kind"], string> = {
  intro: "#8c6ef5",
  era: "#5aaaff",
  milestone: "#fabe5a",
  event: "#6ee6a0",
  outro: "#c8c8dc",
};

const KIND_LABEL: Record<NarrationBeat["kind"], string> = {
  intro: "Overview",
  era: "Chapter",
  milestone: "Milestone",
  event: "Moment",
  outro: "Today",
};

export function NarrationCaption({
  beats,
  t,
  visible,
}: {
  beats: NarrationBeat[];
  t: number;
  visible: boolean;
}) {
  const beat = useMemo(() => activeBeat(beats, t), [beats, t]);
  if (!visible || !beat) return null;
  const color = KIND_COLOR[beat.kind];
  return (
    <div className="pointer-events-none flex justify-center px-4">
      <div
        key={beat.t}
        className="max-w-2xl animate-[fadeIn_320ms_ease-out] rounded-xl bg-black/55 px-5 py-3 text-center backdrop-blur"
        style={{ borderBottom: `2px solid ${color}` }}
      >
        <div
          className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest"
          style={{ color }}
        >
          {KIND_LABEL[beat.kind]}
        </div>
        <p className="text-sm font-medium leading-snug text-fg sm:text-base">{beat.text}</p>
      </div>
    </div>
  );
}
