"use client";

import type { Theme } from "@/lib/colors";

const THEMES: { id: Theme; label: string; swatch: string }[] = [
  { id: "nebula", label: "Nebula", swatch: "linear-gradient(135deg,#4a8fff,#d245f5)" },
  { id: "ember", label: "Ember", swatch: "linear-gradient(135deg,#ff8c1a,#d12500)" },
  { id: "mono", label: "Mono", swatch: "linear-gradient(135deg,#1a33cc,#eef5ff)" },
];

export function ThemePicker({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (t: Theme) => void;
}) {
  return (
    <div className="flex gap-1.5 rounded-lg bg-black/40 p-1.5 backdrop-blur" role="group" aria-label="Color theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.label}
          aria-label={t.label}
          aria-pressed={theme === t.id}
          onClick={() => onChange(t.id)}
          className={`h-6 w-6 rounded-full ring-2 transition ${
            theme === t.id ? "ring-white" : "ring-transparent hover:ring-white/40"
          }`}
          style={{ background: t.swatch }}
        />
      ))}
    </div>
  );
}
