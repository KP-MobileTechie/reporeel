// ---------------------------------------------------------------------------
// insights/health.ts — a transparent project-health grade. Five factors, each
// with a fixed cap and a plain-language note, summed to 0-100 and graded A-F.
// The point is not a precise metric but a fast, explainable read: every factor
// shows its score AND why, so the grade is never a black box.
// ---------------------------------------------------------------------------

import type { HealthFactor, HealthScore, MomentumTrend } from "./types";

export interface HealthInput {
  contributors: number;
  busFactor: number;
  testFileCount: number;
  liveFiles: number;
  hasReadme: boolean;
  hasDocs: boolean;
  momentum: MomentumTrend;
  moduleCount: number;
}

const MOMENTUM_SCORE: Record<MomentumTrend, number> = {
  accelerating: 20,
  steady: 16,
  slowing: 10,
  dormant: 4,
};

export function scoreHealth(i: HealthInput): HealthScore {
  const factors: HealthFactor[] = [];

  // Tests (max 25): presence first, then how much of the tree is tests.
  const testRatio = i.liveFiles > 0 ? i.testFileCount / i.liveFiles : 0;
  const testScore = i.testFileCount > 0 ? Math.round(Math.min(25, 12 + testRatio * 100)) : 0;
  factors.push({
    name: "Tests",
    score: testScore,
    max: 25,
    note:
      i.testFileCount === 0
        ? "No test files found."
        : `${i.testFileCount} test file${i.testFileCount === 1 ? "" : "s"} (${Math.round(testRatio * 100)}% of files).`,
  });

  // Documentation (max 15).
  const docScore = (i.hasReadme ? 9 : 0) + (i.hasDocs ? 6 : 0);
  factors.push({
    name: "Documentation",
    score: docScore,
    max: 15,
    note: i.hasReadme ? (i.hasDocs ? "README and a docs folder present." : "README present.") : "No README found.",
  });

  // Collaboration (max 25): more shared knowledge = lower key-person risk.
  const collabScore = Math.min(25, i.busFactor * 9 + (i.contributors > 1 ? 7 : 0));
  factors.push({
    name: "Collaboration",
    score: collabScore,
    max: 25,
    note:
      i.contributors <= 1
        ? "Single contributor — high key-person risk."
        : `${i.contributors} contributors, bus factor ${i.busFactor}.`,
  });

  // Momentum (max 20).
  factors.push({
    name: "Momentum",
    score: MOMENTUM_SCORE[i.momentum],
    max: 20,
    note: `Activity is ${i.momentum}.`,
  });

  // Structure (max 15): a sane number of top-level modules.
  const orgScore = i.moduleCount >= 3 && i.moduleCount <= 20 ? 15 : i.moduleCount < 3 ? 8 : 11;
  factors.push({
    name: "Structure",
    score: orgScore,
    max: 15,
    note: `${i.moduleCount} top-level module${i.moduleCount === 1 ? "" : "s"}.`,
  });

  const score = factors.reduce((s, f) => s + f.score, 0);
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";

  const frac = (f: HealthFactor) => f.score / f.max;
  const best = [...factors].sort((a, b) => frac(b) - frac(a))[0];
  const worst = [...factors].sort((a, b) => frac(a) - frac(b))[0];
  const summary =
    best.name === worst.name
      ? `Grade ${grade}.`
      : `Grade ${grade}. Strongest on ${best.name.toLowerCase()}; weakest on ${worst.name.toLowerCase()}.`;

  return { score, grade, summary, factors };
}
