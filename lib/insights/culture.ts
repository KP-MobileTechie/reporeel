// ---------------------------------------------------------------------------
// insights/culture.ts — engineering culture from commit messages alone. Detects
// conventional-commit adoption, low-effort messages ("wip", "fix", "asdf"),
// test-discipline mentions, revert rate, and message detail, rolls them into a
// 0-100 "commit hygiene" grade, and trends that grade era by era so you can see
// culture shift ("quality dropped after the reorg"). Pure and deterministic.
// ---------------------------------------------------------------------------

import type { Commit } from "@/lib/types";
import type { CultureMetric, CultureScore, Era } from "./types";

const CONVENTIONAL = new Set(["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"]);
const LOW_EFFORT = /^(wip|fixup|fix|update|updates|stuff|asdf|qwer|misc|tmp|temp|minor|changes?|edit|edits|\.|\.\.|todo|test|testing|cleanup|oops|typo)$/i;

function isConventional(msg: string): boolean {
  const m = msg.match(/^([a-zA-Z]+)(\([^)]*\))?!?:\s/);
  return !!m && CONVENTIONAL.has(m[1].toLowerCase());
}

function isLowEffort(msg: string): boolean {
  const t = msg.trim();
  return t.length < 8 || LOW_EFFORT.test(t);
}

function scoreFrom(commits: Commit[]): { score: number; conv: number; low: number; test: number; revert: number; avgLen: number } {
  const n = commits.length || 1;
  let conv = 0;
  let low = 0;
  let test = 0;
  let revert = 0;
  let totalLen = 0;
  for (const c of commits) {
    const m = c.message;
    if (isConventional(m)) conv++;
    if (isLowEffort(m)) low++;
    if (/\b(test|tests|spec|coverage)\b/i.test(m)) test++;
    if (/^revert/i.test(m.trim())) revert++;
    totalLen += m.trim().length;
  }
  const convPct = (conv / n) * 100;
  const lowPct = (low / n) * 100;
  const testPct = (test / n) * 100;
  const avgLen = totalLen / n;

  // Additive hygiene score with capped components.
  const score = Math.round(
    Math.min(35, (convPct / 100) * 35) + // conventional adoption
      Math.min(35, ((100 - lowPct) / 100) * 35) + // descriptive (not low-effort)
      Math.min(20, avgLen / 3) + // detail (60 chars → full 20)
      Math.min(10, (testPct / 100) * 40), // test discipline
  );
  return { score: Math.max(0, Math.min(100, score)), conv: convPct, low: lowPct, test: testPct, revert: (revert / n) * 100, avgLen };
}

function gradeOf(score: number): string {
  return score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";
}

export function analyzeCulture(commits: Commit[], eras: Era[]): CultureScore {
  const s = scoreFrom(commits);
  const grade = gradeOf(s.score);

  const metrics: CultureMetric[] = [
    { name: "Conventional commits", detail: "messages with a feat/fix/... prefix", pct: Math.round(s.conv) },
    { name: "Descriptive messages", detail: "not low-effort (wip / fix / asdf)", pct: Math.round(100 - s.low) },
    { name: "Test mentions", detail: "messages referencing tests", pct: Math.round(s.test) },
    { name: "Avg message length", detail: `${Math.round(s.avgLen)} characters`, pct: Math.min(100, Math.round((s.avgLen / 60) * 100)) },
  ];

  const strongest = [...metrics].sort((a, b) => b.pct - a.pct)[0];
  const weakest = [...metrics].sort((a, b) => a.pct - b.pct)[0];
  const verdict =
    strongest.name === weakest.name
      ? `Commit hygiene grade ${grade}.`
      : `Commit hygiene grade ${grade}. Strongest on ${strongest.name.toLowerCase()}; weakest on ${weakest.name.toLowerCase()}.`;

  // Per-era trend (commits bucketed by era window, so it shows change over time).
  const trend = eras.map((e) => {
    const bucket = commits.filter((c) => c.date >= e.t0 && (e.index === eras.length - 1 ? c.date <= e.t1 : c.date < e.t1));
    return { index: e.index, label: e.label, score: bucket.length ? scoreFrom(bucket).score : 0 };
  });

  return { score: s.score, grade, verdict, metrics, trend };
}
