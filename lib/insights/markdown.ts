// ---------------------------------------------------------------------------
// insights/markdown.ts — render a ProjectBrief as a portable ONBOARDING.md.
// This turns the live Coordinator into a file a maintainer can commit to their
// repo so every future contributor lands on the same orientation. Pure string
// building; GitHub-flavored Markdown.
// ---------------------------------------------------------------------------

import type { ProjectBrief } from "./types";

function fmtDate(ms: number): string {
  if (!ms) return "unknown";
  return new Date(ms).toISOString().slice(0, 10);
}

export function briefToMarkdown(b: ProjectBrief): string {
  const L: string[] = [];
  const s = b.stats;

  L.push(`# ${b.name} — Onboarding Guide`);
  L.push("");
  L.push(`> ${b.headline}`);
  L.push("");
  L.push(b.summary);
  L.push("");

  L.push("## At a glance");
  L.push("");
  L.push("| | |");
  L.push("|---|---|");
  L.push(`| Type | ${b.projectType.type} |`);
  L.push(`| Commits | ${s.totalCommits.toLocaleString()} |`);
  L.push(`| Current files | ${s.filesAlive.toLocaleString()} |`);
  L.push(`| Contributors | ${s.contributors.toLocaleString()} |`);
  L.push(`| History | ${fmtDate(s.firstCommit)} to ${fmtDate(s.lastCommit)} |`);
  if (b.techStack.length) L.push(`| Stack | ${b.techStack.map((t) => t.name).join(", ")} |`);
  if (b.conventions.signals.length) L.push(`| Conventions | ${b.conventions.signals.join(", ")} |`);
  L.push("");

  if (b.readingPath.length) {
    L.push("## Start here");
    L.push("");
    L.push("Read these in order to get oriented fast:");
    L.push("");
    for (const st of b.readingPath) L.push(`${st.order}. \`${st.path}\` — ${st.role}. ${st.why}`);
    L.push("");
  }

  if (b.firstFiles.length) {
    L.push("## Good first files");
    L.push("");
    L.push("Approachable, low-risk places to make a first change:");
    L.push("");
    for (const f of b.firstFiles) L.push(`- \`${f.path}\` — ${f.role} (${f.why})`);
    L.push("");
  }

  if (b.glossary.length) {
    L.push("## Vocabulary");
    L.push("");
    L.push(b.glossary.map((g) => `\`${g.term}\``).join(", "));
    L.push("");
  }

  if (b.modules.length) {
    L.push("## Map of the codebase");
    L.push("");
    for (const m of b.modules) {
      L.push(`### \`${m.dir}\` — ${m.liveCount} file${m.liveCount === 1 ? "" : "s"}`);
      L.push("");
      L.push(m.purpose);
      L.push("");
      for (const f of m.files) L.push(`- \`${f.name}\` — ${f.role}`);
      L.push("");
    }
  }

  if (b.activity.highlights.length) {
    L.push("## Recent highlights");
    L.push("");
    for (const h of b.activity.highlights) L.push(`- **${h.type}**: ${h.message} (${h.author})`);
    L.push("");
  }

  if (b.activity.types.length) {
    L.push("## Work breakdown");
    L.push("");
    L.push(`Momentum: ${b.activity.momentum.note}`);
    L.push(`Commit hygiene: ${b.culture.score}/100 (${b.culture.grade}).`);
    L.push("");
    for (const t of b.activity.types) L.push(`- ${t.type}: ${t.count} (${t.pct}%)`);
    L.push("");
  }

  if (b.events.length) {
    L.push("## Notable moments");
    L.push("");
    for (const e of b.events) L.push(`- **${e.kind}**: ${e.title} — ${e.detail}`);
    L.push("");
  }

  if (b.keyFiles.length) {
    L.push("## Files that matter most");
    L.push("");
    for (const f of b.keyFiles) L.push(`- \`${f.path}\` — ${f.role} (${f.reason})`);
    L.push("");
  }

  if (b.coupling.length) {
    L.push("## Files that change together");
    L.push("");
    L.push("Editing one of these often means editing its partner:");
    L.push("");
    for (const c of b.coupling)
      L.push(`- \`${c.a}\` ↔ \`${c.b}\` (${c.together}× together, ${Math.round(c.score * 100)}% coupled)`);
    L.push("");
  }

  L.push("## Health & ownership");
  L.push("");
  L.push(`Health score: **${b.health.score}/100 (${b.health.grade})** — ${b.health.summary}`);
  L.push("");
  for (const f of b.health.factors) L.push(`- ${f.name}: ${f.score}/${f.max} — ${f.note}`);
  L.push("");
  L.push(`Bus factor: **${b.risk.busFactor}** — ${b.risk.busFactorNote}`);
  L.push("");
  for (const n of b.risk.notes) L.push(`- ${n}`);
  L.push("");
  if (b.risk.ownership.length) {
    L.push("Folder ownership (by share of churn):");
    L.push("");
    for (const o of b.risk.ownership) L.push(`- \`${o.dir}\` — ${o.owner} (${o.sharePct}%)`);
    L.push("");
  }
  if (b.risk.hotspots.length) {
    L.push("Maintenance hotspots:");
    L.push("");
    for (const h of b.risk.hotspots) L.push(`- \`${h.path}\` — ${h.note}`);
    L.push("");
  }
  if (b.risk.stale.length) {
    L.push("Possibly stale (untouched for a while):");
    L.push("");
    for (const sf of b.risk.stale) L.push(`- \`${sf.path}\` — ${sf.note}`);
    L.push("");
  }

  if (b.team.fingerprints.length > 1) {
    L.push("## Team");
    L.push("");
    L.push(b.team.note);
    L.push("");
    for (const f of b.team.fingerprints) {
      const areas = f.topAreas.length ? `, mostly in ${f.topAreas.join(", ")}` : "";
      L.push(`- ${f.author} — ${f.style} (${f.commits} commits, ${f.avgCommitSize} files/commit)${areas}`);
    }
    L.push("");
    if (b.team.brokers.length) {
      L.push(`Knowledge brokers: ${b.team.brokers.join(", ")}.`);
      L.push("");
    }
  }

  L.push("---");
  L.push("");
  L.push("_Generated by [RepoReel](https://reporeel-fawn.vercel.app) from commit history._");
  L.push("");

  return L.join("\n");
}
