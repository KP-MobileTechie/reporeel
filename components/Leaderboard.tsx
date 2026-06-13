"use client";

export interface LeaderRow {
  author: string;
  commits: number;
}

export function Leaderboard({ rows }: { rows: LeaderRow[] }) {
  if (rows.length === 0) return null;
  const max = rows[0].commits || 1;
  return (
    <div className="pointer-events-none w-56 select-none rounded-lg bg-black/40 px-4 py-3 text-sm backdrop-blur">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-dim">
        Top contributors
      </div>
      <ol className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.author} className="relative">
            <div
              className="absolute inset-y-0 left-0 rounded bg-accent/25"
              style={{ width: `${(r.commits / max) * 100}%` }}
            />
            <div className="relative flex justify-between gap-2 px-1.5 py-0.5">
              <span className="truncate text-fg" title={r.author}>
                {r.author}
              </span>
              <span className="tabular-nums text-fg-dim">{r.commits}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
