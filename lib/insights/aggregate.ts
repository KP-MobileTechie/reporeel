// ---------------------------------------------------------------------------
// insights/aggregate.ts — fold a commit list into per-file and per-author
// aggregates in a single pass. Shared by keyFiles, architecture, and eras so
// the whole brief is built from one consistent traversal.
//
// Lifecycle: commits are processed oldest-first; a `live` set tracks which
// paths still exist at the end (add/modify → present, delete → gone, rename →
// old path gone, new path present). Churn for a recorded change is attributed
// to its `path`; a rename additionally registers `toPath` as a touched, live
// file so the codebase map reflects the file's current name.
// ---------------------------------------------------------------------------

import type { Commit } from "@/lib/types";
import { langOf } from "@/lib/colors";

export interface FileAgg {
  path: string;
  churn: number;
  commits: number;
  firstSeen: number;
  lastSeen: number;
  authors: Set<string>;
  alive: boolean;
  lang: string;
}

export interface AuthorAgg {
  author: string;
  commits: number;
  churn: number;
  /** dir → churn contributed there. */
  dirs: Map<string, number>;
  firstCommit: number;
}

export interface AggResult {
  files: Map<string, FileAgg>;
  authors: Map<string, AuthorAgg>;
  langCounts: { lang: string; count: number }[];
  filesAlive: number;
}

/** Top-level directory of a path, or "(root)" for repo-root files. */
export function topDir(path: string): string {
  const i = path.indexOf("/");
  return i < 0 ? "(root)" : path.slice(0, i);
}

function touchFile(
  files: Map<string, FileAgg>,
  path: string,
  date: number,
  author: string,
  churn: number,
): FileAgg {
  let f = files.get(path);
  if (!f) {
    f = {
      path,
      churn: 0,
      commits: 0,
      firstSeen: date,
      lastSeen: date,
      authors: new Set(),
      alive: false,
      lang: langOf(path),
    };
    files.set(path, f);
  }
  f.churn += churn;
  f.commits += 1;
  f.firstSeen = Math.min(f.firstSeen, date);
  f.lastSeen = Math.max(f.lastSeen, date);
  f.authors.add(author);
  return f;
}

/** Single-pass aggregation of a (date-ascending) commit list. */
export function aggregate(commits: Commit[]): AggResult {
  const sorted = [...commits].sort((a, b) => a.date - b.date);
  const files = new Map<string, FileAgg>();
  const authors = new Map<string, AuthorAgg>();
  const live = new Set<string>();

  for (const c of sorted) {
    let aa = authors.get(c.author);
    if (!aa) {
      aa = { author: c.author, commits: 0, churn: 0, dirs: new Map(), firstCommit: c.date };
      authors.set(c.author, aa);
    }
    aa.commits += 1;
    aa.firstCommit = Math.min(aa.firstCommit, c.date);

    for (const ch of c.changes) {
      const churn = Math.abs(ch.delta) || 0;
      touchFile(files, ch.path, c.date, c.author, churn);
      aa.churn += churn;
      const d = topDir(ch.path);
      aa.dirs.set(d, (aa.dirs.get(d) ?? 0) + churn);

      switch (ch.type) {
        case "add":
        case "modify":
          live.add(ch.path);
          break;
        case "delete":
          live.delete(ch.path);
          break;
        case "rename":
          live.delete(ch.path);
          if (ch.toPath) {
            live.add(ch.toPath);
            // Register the new name as a touched file (no double-counted churn).
            touchFile(files, ch.toPath, c.date, c.author, 0);
          }
          break;
      }
    }
  }

  // Resolve final alive flags.
  for (const f of files.values()) f.alive = live.has(f.path);

  // Language histogram over all distinct files.
  const langMap = new Map<string, number>();
  for (const f of files.values()) langMap.set(f.lang, (langMap.get(f.lang) ?? 0) + 1);
  const langCounts = [...langMap.entries()]
    .map(([lang, count]) => ({ lang, count }))
    .sort((a, b) => b.count - a.count || a.lang.localeCompare(b.lang));

  return { files, authors, langCounts, filesAlive: live.size };
}
