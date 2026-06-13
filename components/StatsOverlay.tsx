"use client";

export interface Stats {
  repoName: string;
  aliveCount: number;
  commitsDone: number;
  commitsTotal: number;
  contributors: number;
}

export function StatsOverlay({ stats }: { stats: Stats }) {
  return (
    <div className="pointer-events-none select-none rounded-lg bg-black/40 px-4 py-3 text-sm backdrop-blur">
      <div className="truncate font-semibold text-fg" title={stats.repoName}>
        {stats.repoName}
      </div>
      <dl className="mt-1.5 space-y-0.5 text-fg-dim">
        <div className="flex gap-2">
          <dt className="w-24">Files alive</dt>
          <dd className="tabular-nums text-fg">{stats.aliveCount.toLocaleString()}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24">Commits</dt>
          <dd className="tabular-nums text-fg">
            {stats.commitsDone.toLocaleString()} / {stats.commitsTotal.toLocaleString()}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24">Contributors</dt>
          <dd className="tabular-nums text-fg">{stats.contributors.toLocaleString()}</dd>
        </div>
      </dl>
    </div>
  );
}
