"use client";

// ---------------------------------------------------------------------------
// FileCard — the popover shown when you click a star in the galaxy. It connects
// the visualization to the Coordinator: given the clicked file's path, it pulls
// that file's role, churn, importance, risk flags and co-change partners from
// the already-computed ProjectBrief. No new computation, no network.
// ---------------------------------------------------------------------------

import type { ProjectBrief, FileCategory } from "@/lib/insights/types";
import { roleOf } from "@/lib/insights/fileRoles";

const CAT_COLOR: Record<FileCategory, string> = {
  ui: "#5aaaff",
  logic: "#8c6ef5",
  engine: "#ff8c5a",
  test: "#6ee6a0",
  config: "#fabe5a",
  build: "#fabe5a",
  docs: "#9aa0c0",
  style: "#e05ad8",
  data: "#22d3ee",
  asset: "#8b91b3",
  other: "#8b91b3",
};

export function FileCard({
  brief,
  path,
  x,
  y,
  onClose,
}: {
  brief: ProjectBrief;
  path: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  // Look the file up in the brief's module directory.
  let role = "";
  let category: FileCategory = "other";
  let churn: number | null = null;
  let commits: number | null = null;
  let dir = "";
  let found = false;
  for (const m of brief.modules) {
    const f = m.files.find((ff) => ff.path === path);
    if (f) {
      role = f.role;
      category = f.category;
      churn = f.churn;
      commits = f.commits;
      dir = m.dir;
      found = true;
      break;
    }
  }
  if (!found) {
    const r = roleOf(path);
    role = r.role;
    category = r.category;
  }

  const key = brief.keyFiles.find((k) => k.path === path);
  const partners = brief.coupling
    .filter((c) => c.a === path || c.b === path)
    .map((c) => (c.a === path ? c.b : c.a));
  const isHotspot = brief.risk.hotspots.some((h) => h.path === path);
  const isStale = brief.risk.stale.some((s) => s.path === path);
  const name = path.split("/").pop() ?? path;

  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.max(8, Math.min(x + 14, vw - 296));
  const top = Math.max(8, Math.min(y + 14, vh - 300));

  return (
    <div
      role="dialog"
      aria-label={`File: ${path}`}
      className="pointer-events-auto fixed z-30 w-72 rounded-xl border border-border bg-surface/95 p-4 shadow-2xl backdrop-blur"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CAT_COLOR[category] }} aria-hidden />
          <code className="truncate text-sm font-semibold text-fg" title={path}>
            {name}
          </code>
        </div>
        <button type="button" onClick={onClose} className="-mr-1 -mt-1 rounded px-1.5 py-0.5 text-fg-dim hover:text-fg" aria-label="Close">
          ✕
        </button>
      </div>

      <p className="mt-1 text-xs text-fg-dim">{role}</p>

      {(churn !== null || commits !== null) && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg border border-border bg-black/20 px-2 py-1.5">
            <div className="tabular-nums text-sm font-semibold text-fg">{commits ?? "—"}</div>
            <div className="text-[10px] uppercase tracking-wide text-fg-dim">commits</div>
          </div>
          <div className="rounded-lg border border-border bg-black/20 px-2 py-1.5">
            <div className="tabular-nums text-sm font-semibold text-fg">{churn?.toLocaleString() ?? "—"}</div>
            <div className="text-[10px] uppercase tracking-wide text-fg-dim">churn</div>
          </div>
        </dl>
      )}

      {(key || isHotspot || isStale || dir) && (
        <ul className="mt-3 space-y-1 text-[11px] text-fg-dim">
          {dir && (
            <li>
              In <code className="text-fg">{dir}</code>
            </li>
          )}
          {key && <li>⭐ Key file — {key.reason}</li>}
          {isHotspot && <li style={{ color: "#fa6666" }}>🔥 Maintenance hotspot</li>}
          {isStale && <li style={{ color: "#fabe5a" }}>🕒 Possibly stale</li>}
          {!found && <li>No longer in the final tree (historical file).</li>}
        </ul>
      )}

      {partners.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-dim">Changes with</div>
          <ul className="space-y-0.5">
            {partners.slice(0, 4).map((p) => (
              <li key={p}>
                <code className="block truncate text-[11px] text-fg" title={p}>
                  {p.split("/").pop()}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 truncate border-t border-border pt-2 text-[10px] text-fg-dim" title={path}>
        {path}
      </div>
    </div>
  );
}
