"use client";

// ---------------------------------------------------------------------------
// CoordinatorPanel — the "AI Coordinator" guide, organized into audience tabs:
//
//   Overview   — what the project is, stack, chapters, contributors.
//   Files      — searchable, expandable directory of every current file + role,
//                plus the files that matter most.
//   Onboarding — a "start here" reading path and the files that change together.
//   Health     — bus factor, ownership and maintenance hotspots (for leads).
//
// A Download button exports the whole brief as a portable ONBOARDING.md. All
// content comes from a deterministic ProjectBrief — no network calls, so it
// works identically on a private local repo.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectBrief, FileCategory, DepGraph } from "@/lib/insights/types";
import { briefToMarkdown } from "@/lib/insights/markdown";
import { buildTreemap } from "@/lib/insights/treemap";
import { buildFileTree, buildSunburst, type TreeNode } from "@/lib/insights/tree";
import { isGeneratedPath } from "@/lib/insights/fileRoles";
import { answerQuery, EXAMPLE_QUESTIONS, type Answer } from "@/lib/insights/ask";
import { groundedSystem, streamCopilot, type ChatMessage } from "@/lib/ai/copilot";
import { buildBrief } from "@/lib/insights/brief";
import { applyScenario } from "@/lib/insights/simulate";
import type { CommitTimeline } from "@/lib/types";

const CATEGORY_DOT: Record<FileCategory, string> = {
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

type Tab = "ask" | "overview" | "activity" | "stats" | "files" | "deps" | "onboarding" | "team" | "health";
const TABS: { id: Tab; label: string }[] = [
  { id: "ask", label: "Ask" },
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "stats", label: "Stats" },
  { id: "files", label: "Files" },
  { id: "deps", label: "Deps" },
  { id: "onboarding", label: "Onboarding" },
  { id: "team", label: "Team" },
  { id: "health", label: "Health" },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const LANG_COLOR: Record<string, string> = {
  ts: "#4a90ff",
  js: "#f7df1e",
  css: "#d14fef",
  md: "#66e68d",
  config: "#fb921e",
  py: "#45c2fa",
  rs: "#f5593a",
  go: "#00c7ba",
  html: "#fa6666",
  other: "#8b91b3",
};

const TYPE_COLOR: Record<string, string> = {
  feat: "#6ee6a0",
  fix: "#fa6666",
  refactor: "#8c6ef5",
  perf: "#fabe5a",
  docs: "#9aa0c0",
  test: "#5aaaff",
  style: "#e05ad8",
  chore: "#8b91b3",
  build: "#fb921e",
  ci: "#45c2fa",
  revert: "#f5593a",
  other: "#6b7290",
};

const TREND_LABEL: Record<string, string> = {
  accelerating: "Accelerating",
  steady: "Steady",
  slowing: "Slowing down",
  dormant: "Dormant",
};

const EVENT_COLOR: Record<string, string> = {
  rewrite: "#8c6ef5",
  cleanup: "#fa6666",
  feature: "#6ee6a0",
  newcomer: "#5aaaff",
  departure: "#9aa0c0",
};

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

function stripTicks(s: string): string {
  return s.replace(/`/g, "");
}

function shortName(path: string): string {
  return path.split("/").pop() ?? path;
}

function safeName(brief: ProjectBrief): string {
  return brief.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
}

function downloadBlob(content: string, type: string, filename: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function downloadMarkdown(brief: ProjectBrief): void {
  downloadBlob(briefToMarkdown(brief), "text/markdown", `ONBOARDING-${safeName(brief)}.md`);
}

function downloadJson(brief: ProjectBrief): void {
  downloadBlob(JSON.stringify(brief, null, 2), "application/json", `reporeel-brief-${safeName(brief)}.json`);
}

function copyMarkdown(brief: ProjectBrief): void {
  const md = briefToMarkdown(brief);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(md).catch(() => fallbackCopy(md));
  } else {
    fallbackCopy(md);
  }
}

function fallbackCopy(text: string): void {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    /* clipboard unavailable */
  }
  ta.remove();
}

export function CoordinatorPanel({
  brief,
  commitTimeline,
  depGraph,
  open,
  onClose,
  onSeek,
}: {
  brief: ProjectBrief;
  commitTimeline?: CommitTimeline | null;
  depGraph?: DepGraph | null;
  open: boolean;
  onClose: () => void;
  onSeek: (t: number) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Initial tab can be deep-linked via ?guide=<tab> for shareable views.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "overview";
    const g = new URLSearchParams(window.location.search).get("guide");
    return TABS.some((t) => t.id === g) ? (g as Tab) : "overview";
  });

  // Reflect the active tab in the URL (replaceState, no history spam) so the
  // current view is shareable: a teammate's link opens straight to this tab.
  const selectTab = (next: Tab) => {
    setTab(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("guide", next);
      window.history.replaceState(null, "", url);
    }
  };

  // Keep the latest onClose without making it an effect dependency. The parent
  // (Theater) re-renders ~10x/sec from playback timers, recreating onClose each
  // time; depending on it here would re-run the effect constantly and steal
  // focus from inputs (e.g. the Ask box) mid-keystroke. The effect must fire
  // only when `open` actually changes.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label="AI Coordinator: project guide"
      className={`pointer-events-auto fixed right-0 top-0 z-20 flex h-full w-[min(440px,94vw)] flex-col border-l border-border bg-surface/95 shadow-2xl backdrop-blur transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-accent">
            <span aria-hidden>✦</span> AI Coordinator
          </div>
          <h2 className="mt-1 text-base font-semibold text-fg">{brief.name}</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => downloadMarkdown(brief)}
            className="rounded-lg border border-border px-2.5 py-1 text-xs text-fg-dim hover:border-accent hover:text-fg"
            title="Download this guide as ONBOARDING.md"
          >
            ↓ Guide
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-fg-dim hover:text-fg"
            aria-label="Close coordinator"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Coordinator views" className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            type="button"
            onClick={() => selectTab(t.id)}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === t.id ? "bg-accent/20 text-fg" : "text-fg-dim hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 text-sm">
        {tab === "ask" && <AskTab brief={brief} />}
        {tab === "overview" && <OverviewTab brief={brief} onSeek={onSeek} />}
        {tab === "activity" && <ActivityTab brief={brief} />}
        {tab === "stats" && <StatsTab brief={brief} />}
        {tab === "files" && <FilesTab brief={brief} />}
        {tab === "deps" && <DepsTab depGraph={depGraph ?? null} />}
        {tab === "onboarding" && <OnboardingTab brief={brief} />}
        {tab === "team" && <TeamTab brief={brief} commitTimeline={commitTimeline} />}
        {tab === "health" && <HealthTab brief={brief} />}

        <p className="pt-2 text-[10px] leading-relaxed text-fg-dim">
          Generated locally from this repo&apos;s commit history. Nothing was uploaded.
        </p>
      </div>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
function OverviewTab({ brief, onSeek }: { brief: ProjectBrief; onSeek: (t: number) => void }) {
  return (
    <>
      <section>
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-full bg-accent/20 px-2.5 py-1 text-xs font-semibold text-fg" title={brief.projectType.signals.join("; ")}>
            {brief.projectType.type}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-fg-dim">{brief.projectType.confidence} confidence</span>
        </div>
        <p className="font-medium text-fg">{brief.headline}</p>
        <p className="mt-1 text-xs text-fg-dim">{brief.projectType.tagline}</p>
        <p className="mt-2 leading-relaxed text-fg-dim">{stripTicks(brief.summary)}</p>
        <dl className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="Commits" value={brief.stats.totalCommits.toLocaleString()} />
          <Stat label="Files" value={brief.stats.filesAlive.toLocaleString()} />
          <Stat label="People" value={brief.stats.contributors.toLocaleString()} />
        </dl>
      </section>

      {brief.techStack.length > 0 && (
        <Section title="Tech stack">
          <div className="flex flex-wrap gap-1.5">
            {brief.techStack.map((t) => (
              <span
                key={t.name}
                title={`${t.kind} · ${t.evidence}`}
                className="rounded-full border border-border bg-black/30 px-2.5 py-1 text-xs text-fg"
              >
                {t.name}
              </span>
            ))}
          </div>
        </Section>
      )}

      {brief.conventions.signals.length > 0 && (
        <Section title="Conventions">
          <div className="flex flex-wrap gap-1.5">
            {brief.conventions.signals.map((s) => (
              <span key={s} className="rounded-full border border-border bg-black/20 px-2.5 py-1 text-xs text-fg-dim">
                {s}
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title="Fast facts">
        <dl className="grid grid-cols-3 gap-2">
          <Stat label="Busiest day" value={WEEKDAYS[argmax(brief.metrics.weekday)]} />
          <Stat label="Peak hour" value={`${argmax(brief.metrics.hour)}:00`} />
          <Stat label="Avg commit" value={`${avgCommitFiles(brief)}f`} />
        </dl>
      </Section>

      {brief.glossary.length > 0 && (
        <Section title="Vocabulary">
          <p className="mb-2 text-xs text-fg-dim">Terms that recur across the codebase.</p>
          <div className="flex flex-wrap gap-1.5">
            {brief.glossary.map((g) => (
              <span key={g.term} title={`in ${g.count} files`} className="rounded-full border border-border bg-black/20 px-2 py-0.5 text-[11px] text-fg-dim">
                {g.term}
              </span>
            ))}
          </div>
        </Section>
      )}

      {brief.eras.length > 0 && (
        <Section title="The story, in chapters">
          <ol className="space-y-1.5">
            {brief.eras.map((e) => (
              <li key={e.index}>
                <button
                  type="button"
                  onClick={() => onSeek(e.t0)}
                  className="w-full rounded-lg border border-border bg-black/20 p-3 text-left transition hover:border-accent/60"
                  title="Jump the galaxy to this chapter"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-fg">{e.label}</span>
                    <span className="text-[10px] text-fg-dim">{fmtDate(e.t0)}</span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-fg-dim">{stripTicks(e.summary)}</p>
                </button>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {brief.events.length > 0 && (
        <Section title="Notable moments">
          <ol className="space-y-1.5">
            {brief.events.map((e, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onSeek(e.t)}
                  className="w-full rounded-lg border border-border bg-black/20 p-2.5 text-left transition hover:border-accent/60"
                  title="Jump the galaxy to this moment"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                      style={{ background: (EVENT_COLOR[e.kind] ?? "#8b91b3") + "33", color: EVENT_COLOR[e.kind] ?? "#8b91b3" }}
                    >
                      {e.kind}
                    </span>
                    <span className="truncate text-xs font-medium text-fg">{e.title}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-fg-dim">{fmtDate(e.t)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-fg-dim">{e.detail}</p>
                </button>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {brief.contributors.length > 0 && (
        <Section title="Who built what">
          <ul className="space-y-1.5">
            {brief.contributors.map((c) => (
              <li key={c.author} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-fg" title={c.author}>
                  {c.author}
                </span>
                <span className="shrink-0 text-xs text-fg-dim">
                  {c.commits} · {c.focus}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Take it with you">
        <div className="flex flex-wrap gap-2">
          <ExportButton label="Download ONBOARDING.md" onClick={() => downloadMarkdown(brief)} />
          <ExportButton label="Copy Markdown" onClick={() => copyMarkdown(brief)} />
          <ExportButton label="Download JSON" onClick={() => downloadJson(brief)} />
        </div>
      </Section>
    </>
  );
}

function ExportButton({ label, onClick }: { label: string; onClick: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        onClick();
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
      className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-dim transition hover:border-accent hover:text-fg"
    >
      {done ? "✓ done" : label}
    </button>
  );
}

// ── Ask the repo ────────────────────────────────────────────────────────────
function AskTab({ brief }: { brief: ProjectBrief }) {
  const [query, setQuery] = useState("");
  const answer = useMemo(() => answerQuery(brief, query), [brief, query]);

  // Optional grounded AI copilot (BYO key, held in memory only). Multi-turn:
  // the brief is the constant system grounding; `turns` carries the conversation.
  const [aiKey, setAiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [turns, setTurns] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const askAi = async () => {
    if (!aiKey || !query.trim() || aiLoading) return;
    const convo: ChatMessage[] = [...turns, { role: "user", content: query.trim() }];
    setTurns(convo);
    setStreaming("");
    setAiLoading(true);
    setAiError(null);
    setQuery("");
    let acc = "";
    try {
      await streamCopilot(groundedSystem(brief), convo, { apiKey: aiKey }, (d) => {
        acc += d;
        setStreaming(acc);
      });
      setTurns([...convo, { role: "assistant", content: acc || "(no answer)" }]);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI request failed.");
    } finally {
      setStreaming(null);
      setAiLoading(false);
    }
  };

  // Per-repo conversation memory: restore on load, persist on change. Local to
  // the browser (localStorage) — nothing leaves the device.
  const storageKey = `reporeel-chat:${brief.name}`;
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      const parsed = saved ? JSON.parse(saved) : [];
      setTurns(Array.isArray(parsed) ? parsed : []);
    } catch {
      setTurns([]);
    }
  }, [storageKey]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (turns.length) window.localStorage.setItem(storageKey, JSON.stringify(turns));
      else window.localStorage.removeItem(storageKey);
    } catch {
      /* storage disabled or over quota — non-fatal */
    }
  }, [turns, storageKey]);

  return (
    <>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Ask about this repo…"
        aria-label="Ask about this repository"
        autoFocus
        className="w-full rounded-lg border border-border bg-black/30 px-3 py-2.5 text-sm text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
      />
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLE_QUESTIONS.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setQuery(ex)}
            className="rounded-full border border-border bg-black/20 px-2.5 py-1 text-[11px] text-fg-dim transition hover:border-accent hover:text-fg"
          >
            {ex}
          </button>
        ))}
      </div>
      <AnswerView answer={answer} />

      {/* Grounded AI copilot — optional, BYO key */}
      <Section title="AI answer (grounded)">
        <p className="mb-2 text-[11px] leading-relaxed text-fg-dim">
          Optional: with your own Anthropic or Google Gemini API key, get a written answer grounded in the facts above.
          The key stays in your browser and is never stored or sent anywhere except your chosen provider.
        </p>
        {showKey ? (
          <div className="flex gap-2">
            <input
              type="password"
              value={aiKey}
              onChange={(e) => setAiKey(e.target.value)}
              placeholder="sk-ant-… or AIza… (Anthropic or Gemini)"
              aria-label="Anthropic or Gemini API key"
              className="min-w-0 flex-1 rounded-lg border border-border bg-black/30 px-3 py-2 text-xs text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={askAi}
              disabled={!aiKey || !query.trim() || aiLoading}
              className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {aiLoading ? "Thinking…" : "Ask AI"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowKey(true)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-dim transition hover:border-accent hover:text-fg"
          >
            ✨ Enable AI answers
          </button>
        )}
        {aiError && <p className="mt-2 text-xs text-red-400">{aiError}</p>}
        {(turns.length > 0 || streaming !== null) && (
          <div className="mt-3 space-y-2">
            {turns.map((m, i) => (
              <div
                key={i}
                className={`whitespace-pre-wrap rounded-lg border border-border p-2.5 text-xs leading-relaxed ${
                  m.role === "user" ? "bg-accent/10 text-fg" : "bg-black/20 text-fg"
                }`}
              >
                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-fg-dim">
                  {m.role === "user" ? "You" : "Coordinator"}
                </span>
                {m.content}
              </div>
            ))}
            {streaming !== null && (
              <div className="whitespace-pre-wrap rounded-lg border border-border bg-black/20 p-2.5 text-xs leading-relaxed text-fg">
                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-fg-dim">Coordinator</span>
                {streaming || "…"}
              </div>
            )}
            {turns.length > 0 && streaming === null && (
              <button
                type="button"
                onClick={() => setTurns([])}
                className="text-[11px] text-fg-dim hover:text-fg"
              >
                Clear conversation
              </button>
            )}
          </div>
        )}
      </Section>
    </>
  );
}

function AnswerView({ answer }: { answer: Answer }) {
  return (
    <section className="rounded-lg border border-border bg-black/20 p-4">
      <h3 className="text-sm font-semibold text-fg">{answer.title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-fg-dim">{answer.text}</p>
      {answer.files && answer.files.length > 0 && (
        <ul className="mt-3 space-y-1">
          {answer.files.map((f) => (
            <li key={f.path} className="flex items-baseline gap-2">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: CATEGORY_DOT[f.category] }}
                aria-hidden
              />
              <code className="truncate text-xs text-fg" title={f.path}>
                {f.path}
              </code>
              <span className="ml-auto shrink-0 text-right text-[11px] text-fg-dim">{f.role}</span>
            </li>
          ))}
        </ul>
      )}
      {answer.bullets && answer.bullets.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {answer.bullets.map((b, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed text-fg-dim">
              <span aria-hidden className="text-accent">
                •
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Activity ──────────────────────────────────────────────────────────────────
function ActivityTab({ brief }: { brief: ProjectBrief }) {
  const a = brief.activity;
  const maxBucket = Math.max(1, ...a.buckets);
  return (
    <>
      <section className="rounded-lg border border-border bg-black/20 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-wider text-fg-dim">Momentum</span>
          <span className="text-sm font-semibold text-fg">{TREND_LABEL[a.momentum.trend]}</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-fg-dim">{a.momentum.note}</p>
        {/* Cadence sparkline */}
        <div className="mt-3 flex h-12 items-end gap-0.5" aria-label="Commit cadence over time">
          {a.buckets.map((n, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm bg-accent/70"
              style={{ height: `${Math.max(3, (n / maxBucket) * 100)}%` }}
              title={`${n} commit${n === 1 ? "" : "s"}`}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-fg-dim">
          <span>{new Date(brief.stats.firstCommit).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}</span>
          <span>oldest → newest</span>
          <span>{new Date(brief.stats.lastCommit).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}</span>
        </div>
      </section>

      {a.types.length > 0 && (
        <Section title="What kind of work happens here">
          <ul className="space-y-1.5">
            {a.types.map((t) => (
              <li key={t.type}>
                <div className="mb-0.5 flex items-baseline justify-between text-xs">
                  <span className="text-fg">{t.type}</span>
                  <span className="text-fg-dim">
                    {t.count} · {t.pct}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/40">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${t.pct}%`, background: TYPE_COLOR[t.type] ?? TYPE_COLOR.other }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Commit hygiene">
        <div className="rounded-lg border border-border bg-black/20 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-fg-dim">{brief.culture.verdict}</span>
            <span className="text-lg font-bold" style={{ color: GRADE_COLOR[brief.culture.grade] ?? "#8b91b3" }}>
              {brief.culture.grade}
            </span>
          </div>
          <ul className="mt-2 space-y-1.5">
            {brief.culture.metrics.map((m) => (
              <li key={m.name}>
                <div className="mb-0.5 flex items-baseline justify-between text-xs">
                  <span className="text-fg" title={m.detail}>
                    {m.name}
                  </span>
                  <span className="text-fg-dim">{m.pct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/40">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${m.pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
          {brief.culture.trend.length > 1 && (
            <div className="mt-3 flex items-end gap-1">
              {brief.culture.trend.map((p) => (
                <div key={p.index} className="flex flex-1 flex-col items-center gap-0.5">
                  <div className="flex h-10 w-full items-end">
                    <div className="w-full rounded-t bg-accent/60" style={{ height: `${Math.max(4, p.score)}%` }} title={`${p.label}: ${p.score}/100`} />
                  </div>
                  <span className="w-full truncate text-center text-[9px] text-fg-dim" title={p.label}>
                    {p.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {brief.stats.languages.length > 0 && (
        <Section title="Language composition">
          <div className="flex h-3 w-full overflow-hidden rounded-full">
            {languageShares(brief).map((l) => (
              <div
                key={l.lang}
                style={{ width: `${l.pct}%`, background: LANG_COLOR[l.lang] ?? LANG_COLOR.other }}
                title={`${l.lang}: ${l.pct}%`}
              />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-dim">
            {languageShares(brief).map((l) => (
              <li key={l.lang} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm" style={{ background: LANG_COLOR[l.lang] ?? LANG_COLOR.other }} aria-hidden />
                {l.lang} {l.pct}%
              </li>
            ))}
          </ul>
        </Section>
      )}

      {a.highlights.length > 0 && (
        <Section title="Recent highlights">
          <ul className="space-y-1.5">
            {a.highlights.map((h, i) => (
              <li key={i} className="rounded-lg border border-border bg-black/20 p-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                    style={{ background: (TYPE_COLOR[h.type] ?? TYPE_COLOR.other) + "33", color: TYPE_COLOR[h.type] ?? TYPE_COLOR.other }}
                  >
                    {h.type}
                  </span>
                  <span className="truncate text-xs text-fg">{h.message}</span>
                </div>
                <span className="mt-0.5 block text-[10px] text-fg-dim">{h.author}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function argmax(arr: number[]): number {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
  return best;
}

function avgCommitFiles(brief: ProjectBrief): number {
  const mid: Record<string, number> = { "1": 1, "2-3": 2.5, "4-10": 7, "11-30": 20, "31+": 40 };
  let total = 0;
  let n = 0;
  for (const b of brief.metrics.commitSizes) {
    total += (mid[b.label] ?? 1) * b.count;
    n += b.count;
  }
  return n ? Math.round((total / n) * 10) / 10 : 0;
}

function languageShares(brief: ProjectBrief): { lang: string; pct: number }[] {
  const total = brief.stats.languages.reduce((s, l) => s + l.count, 0) || 1;
  return brief.stats.languages
    .map((l) => ({ lang: l.lang, pct: Math.round((l.count / total) * 100) }))
    .filter((l) => l.pct > 0)
    .slice(0, 8);
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function StatsTab({ brief }: { brief: ProjectBrief }) {
  const m = brief.metrics;
  const maxSize = Math.max(1, ...m.commitSizes.map((b) => b.count));
  const maxDay = Math.max(1, ...m.weekday);
  const maxHour = Math.max(1, ...m.hour);
  const maxDirChurn = Math.max(1, ...m.largestDirs.map((d) => d.churn));
  return (
    <>
      {brief.releases.length > 0 && (
        <Section title="Releases">
          <ul className="space-y-1">
            {brief.releases.slice().reverse().map((r, i) => (
              <li key={i} className="flex items-baseline gap-2 rounded-lg border border-border bg-black/20 p-2 text-xs">
                <span className="rounded bg-accent/20 px-1.5 py-0.5 font-semibold text-fg">{r.version ?? "release"}</span>
                <span className="truncate text-fg-dim" title={r.message}>{r.message}</span>
                <span className="ml-auto shrink-0 text-[10px] text-fg-dim">{fmtDate(r.t)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Commit sizes">
        <p className="mb-2 text-xs text-fg-dim">How many files a typical commit changes.</p>
        <ul className="space-y-1.5">
          {m.commitSizes.map((b) => (
            <li key={b.label}>
              <div className="mb-0.5 flex items-baseline justify-between text-xs">
                <span className="text-fg">{b.label} files</span>
                <span className="text-fg-dim">{b.count}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/40">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(b.count / maxSize) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="When work happens (UTC)">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-fg-dim">By weekday</div>
        <div className="flex items-end gap-1">
          {m.weekday.map((n, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
              <div className="flex h-12 w-full items-end">
                <div className="w-full rounded-t bg-accent/70" style={{ height: `${Math.max(3, (n / maxDay) * 100)}%` }} title={`${WEEKDAYS[i]}: ${n}`} />
              </div>
              <span className="text-[8px] text-fg-dim">{WEEKDAYS[i][0]}</span>
            </div>
          ))}
        </div>
        <div className="mb-1 mt-3 text-[10px] uppercase tracking-wide text-fg-dim">By hour</div>
        <div className="flex items-end gap-px">
          {m.hour.map((n, i) => (
            <div key={i} className="flex-1 rounded-t bg-accent/60" style={{ height: `${Math.max(2, (n / maxHour) * 36)}px` }} title={`${i}:00 — ${n}`} />
          ))}
        </div>
      </Section>

      <Section title="Largest folders">
        <ul className="space-y-1.5">
          {m.largestDirs.map((d) => (
            <li key={d.dir}>
              <div className="mb-0.5 flex items-baseline justify-between text-xs">
                <code className="text-fg">{d.dir}</code>
                <span className="text-fg-dim">{d.files} files</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/40">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(d.churn / maxDirChurn) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {m.recentlyActive.length > 0 && (
        <Section title="Recently active">
          <ul className="space-y-0.5">
            {m.recentlyActive.map((p) => (
              <li key={p}>
                <code className="block truncate text-xs text-fg-dim" title={p}>{p}</code>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

// ── Files (searchable directory) ──────────────────────────────────────────────
function FilesTab({ brief }: { brief: ProjectBrief }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(brief.modules[0] ? [brief.modules[0].dir] : []),
  );
  const toggle = (dir: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  const [view, setView] = useState<"list" | "tree" | "map" | "sunburst">("list");
  const [catFilter, setCatFilter] = useState<FileCategory | "all">("all");

  // Categories actually present, for the filter chips.
  const presentCats = useMemo(() => {
    const set = new Set<FileCategory>();
    for (const m of brief.modules) for (const f of m.files) set.add(f.category);
    return [...set];
  }, [brief.modules]);

  const q = query.trim().toLowerCase();
  // A flat result list is shown whenever there's a search term OR a category
  // filter; otherwise the grouped directory is shown.
  const matches = useMemo(() => {
    if (!q && catFilter === "all") return null;
    const out: { dir: string; name: string; path: string; role: string; category: FileCategory }[] = [];
    for (const m of brief.modules) {
      for (const f of m.files) {
        const okQ = !q || f.path.toLowerCase().includes(q) || f.role.toLowerCase().includes(q) || m.dir.toLowerCase().includes(q);
        const okC = catFilter === "all" || f.category === catFilter;
        if (okQ && okC) out.push({ dir: m.dir, name: f.name, path: f.path, role: f.role, category: f.category });
      }
    }
    return out;
  }, [q, catFilter, brief.modules]);

  return (
    <>
      {/* View toggle: four representations of the same tree */}
      <div role="tablist" aria-label="File view" className="flex gap-1 rounded-lg border border-border p-1">
        {(["list", "tree", "map", "sunburst"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            type="button"
            onClick={() => setView(v)}
            className={`flex-1 rounded-md px-2 py-1 text-xs font-medium capitalize transition ${
              view === v ? "bg-accent/20 text-fg" : "text-fg-dim hover:text-fg"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {view === "tree" ? (
        <FileTreeView brief={brief} />
      ) : view === "map" ? (
        <TreemapView brief={brief} />
      ) : view === "sunburst" ? (
        <SunburstView brief={brief} />
      ) : (
        <>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search files or roles…"
        aria-label="Search files"
        className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
      />

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {(["all", ...presentCats] as const).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCatFilter(cat)}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] capitalize transition ${
              catFilter === cat ? "border-accent bg-accent/20 text-fg" : "border-border text-fg-dim hover:text-fg"
            }`}
          >
            {cat !== "all" && (
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: CATEGORY_DOT[cat] }} aria-hidden />
            )}
            {cat}
          </button>
        ))}
      </div>

      {matches ? (
        <Section title={`${matches.length} ${catFilter === "all" ? "match" : catFilter} file${matches.length === 1 ? "" : "s"}`}>
          {matches.length === 0 ? (
            <p className="text-xs text-fg-dim">No files match.</p>
          ) : (
            <ul className="space-y-1">
              {matches.map((f) => (
                <li key={f.path} className="flex items-baseline gap-2 rounded-lg border border-border bg-black/20 p-2">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: CATEGORY_DOT[f.category] }}
                    aria-hidden
                  />
                  <code className="truncate text-xs text-fg" title={f.path}>
                    {f.path}
                  </code>
                  <span className="ml-auto shrink-0 text-[11px] text-fg-dim">{f.role}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : (
        <Section title="Map of the codebase">
          <p className="mb-2 text-xs text-fg-dim">Every folder and what it&apos;s for. Open one to see each file&apos;s job.</p>
          <ul className="space-y-2">
            {brief.modules.map((m) => {
              const isOpen = expanded.has(m.dir);
              return (
                <li key={m.dir} className="overflow-hidden rounded-lg border border-border bg-black/20">
                  <button
                    type="button"
                    onClick={() => toggle(m.dir)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-2 p-3 text-left transition hover:bg-black/20"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: CATEGORY_DOT[m.dominantCategory] }}
                      aria-hidden
                    />
                    <code className="text-fg">{m.dir}</code>
                    <span className="ml-auto text-xs tabular-nums text-fg-dim">
                      {m.liveCount} {m.liveCount === 1 ? "file" : "files"}
                    </span>
                    <span className="text-fg-dim" aria-hidden>
                      {isOpen ? "▾" : "▸"}
                    </span>
                  </button>
                  <p className="px-3 pb-2 text-xs leading-relaxed text-fg-dim">{m.purpose}</p>
                  {isOpen && (
                    <ul className="border-t border-border/60 bg-black/20 px-3 py-2">
                      {m.files.map((f) => (
                        <li key={f.path} className="flex items-baseline gap-2 py-1">
                          <span
                            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ background: CATEGORY_DOT[f.category] }}
                            aria-hidden
                          />
                          <code className="shrink-0 text-xs text-fg" title={f.path}>
                            {f.name}
                          </code>
                          <span className="ml-auto truncate text-right text-[11px] text-fg-dim" title={f.role}>
                            {f.role}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {!matches && brief.keyFiles.length > 0 && (
        <Section title="Files that matter most">
          <ul className="space-y-1.5">
            {brief.keyFiles.map((f) => (
              <li key={f.path} className="rounded-lg border border-border bg-black/20 p-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: CATEGORY_DOT[f.category] }}
                    aria-hidden
                  />
                  <code className="truncate text-xs text-fg" title={f.path}>
                    {f.path}
                  </code>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="text-xs text-fg">{f.role}</span>
                  <span className="shrink-0 text-[10px] text-fg-dim">{f.reason}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
        </>
      )}
    </>
  );
}

// ── Treemap (the codebase at a glance) ──────────────────────────────────────────
function TreemapView({ brief }: { brief: ProjectBrief }) {
  const W = 380;
  const H = 320;
  const [zoomDir, setZoomDir] = useState<string | null>(null);
  const allMods = mapModules(brief);
  const shown = zoomDir ? allMods.filter((m) => m.dir === zoomDir) : allMods;
  const groups = buildTreemap(shown, W, H);
  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5 text-xs">
        <button
          type="button"
          onClick={() => setZoomDir(null)}
          disabled={!zoomDir}
          className="rounded text-fg-dim transition hover:text-fg disabled:text-fg"
        >
          All
        </button>
        {zoomDir && (
          <>
            <span className="text-fg-dim" aria-hidden>▸</span>
            <code className="text-fg">{zoomDir}</code>
          </>
        )}
        <span className="ml-auto text-[11px] text-fg-dim">{zoomDir ? "zoomed in" : "click a folder to zoom"}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full rounded-lg border border-border bg-black/30"
        role="img"
        aria-label="Treemap of the codebase"
      >
        {groups.map((g) => (
          <g key={g.dir}>
            {g.leaves.map((leaf) => (
              <rect
                key={leaf.path}
                x={leaf.x + 0.5}
                y={leaf.y + 0.5}
                width={Math.max(0, leaf.w - 1)}
                height={Math.max(0, leaf.h - 1)}
                fill={CATEGORY_DOT[leaf.category]}
                opacity={0.85}
              >
                <title>{`${leaf.path}\n${leaf.value.toLocaleString()} churn`}</title>
              </rect>
            ))}
            {/* Module outline + label; click to zoom (only when not already zoomed) */}
            <rect
              x={g.x + 0.5}
              y={g.y + 0.5}
              width={Math.max(0, g.w - 1)}
              height={Math.max(0, g.h - 1)}
              fill="transparent"
              stroke="#0b0d1a"
              strokeWidth={1.5}
              style={{ cursor: zoomDir ? "default" : "pointer" }}
              onClick={() => !zoomDir && setZoomDir(g.dir)}
            >
              {!zoomDir && <title>{`${g.dir} — click to zoom`}</title>}
            </rect>
            {g.w > 40 && g.h > 16 && (
              <text x={g.x + 4} y={g.y + 11} fontSize={9} fill="#e8eaf6" className="pointer-events-none font-medium">
                {g.dir}
              </text>
            )}
          </g>
        ))}
      </svg>
      {/* Legend */}
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-dim">
        {[
          ["ui", "UI"],
          ["logic", "Logic"],
          ["engine", "Engine"],
          ["test", "Tests"],
          ["config", "Config"],
          ["style", "Style"],
          ["docs", "Docs"],
        ].map(([cat, label]) => (
          <li key={cat} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: CATEGORY_DOT[cat as FileCategory] }} aria-hidden />
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Dependencies (real import graph; local mode) ───────────────────────────────
function DepsTab({ depGraph }: { depGraph: DepGraph | null }) {
  if (!depGraph || !depGraph.available) {
    return (
      <section className="rounded-lg border border-border bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-fg">Dependency graph</h3>
        <p className="mt-1 text-xs leading-relaxed text-fg-dim">
          The real import graph is built from file contents, which are only available when you drop a local{" "}
          <code>.git</code> folder. Load a local repo to see which modules import which. (For demos and GitHub repos,
          the Onboarding tab&apos;s coupling graph approximates relationships from co-change.)
        </p>
      </section>
    );
  }
  const g = depGraph;
  return (
    <>
      <section className="rounded-lg border border-border bg-black/20 p-4">
        <div className="text-xs uppercase tracking-wider text-fg-dim">Dependency graph</div>
        <p className="mt-1 text-xs text-fg-dim">
          {g.nodeCount} source files, {g.edgeCount} import edges{g.cycles.length > 0 ? `, ${g.cycles.length} cycle${g.cycles.length === 1 ? "" : "s"}` : ""}.
        </p>
      </section>

      {g.mostDependedOn.length > 0 && (
        <Section title="Core (most depended-on)">
          <p className="mb-2 text-xs text-fg-dim">The files the rest of the codebase relies on most.</p>
          <ul className="space-y-1">
            {g.mostDependedOn.map((e) => (
              <li key={e.path} className="flex items-baseline gap-2 text-xs">
                <code className="truncate text-fg" title={e.path}>{e.path}</code>
                <span className="ml-auto shrink-0 text-fg-dim">{e.count} importers</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {g.mostDependencies.length > 0 && (
        <Section title="Most entangled (most imports)">
          <ul className="space-y-1">
            {g.mostDependencies.map((e) => (
              <li key={e.path} className="flex items-baseline gap-2 text-xs">
                <code className="truncate text-fg" title={e.path}>{e.path}</code>
                <span className="ml-auto shrink-0 text-fg-dim">imports {e.count}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {g.cycles.length > 0 && (
        <Section title="Import cycles">
          <p className="mb-2 text-xs text-fg-dim">Circular imports — usually worth breaking.</p>
          <ul className="space-y-1.5">
            {g.cycles.map((cyc, i) => (
              <li key={i} className="rounded-lg border border-border bg-black/20 p-2 text-[11px] text-fg-dim">
                {cyc.map((p) => p.split("/").pop()).join(" → ")}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {g.orphans.length > 0 && (
        <Section title="Isolated files">
          <p className="mb-2 text-xs text-fg-dim">No imports in or out (entry points, configs, or dead code).</p>
          <ul className="space-y-0.5">
            {g.orphans.map((p) => (
              <li key={p}><code className="block truncate text-xs text-fg-dim" title={p}>{p}</code></li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function treeInputs(brief: ProjectBrief) {
  // Exclude generated/lockfiles: their churn would dominate size-based views.
  return brief.modules.flatMap((m) =>
    m.files.filter((f) => !isGeneratedPath(f.path)).map((f) => ({ path: f.path, category: f.category, value: f.churn })),
  );
}

/** Modules with generated/lockfiles stripped from each — for the treemap. */
function mapModules(brief: ProjectBrief) {
  return brief.modules
    .map((m) => ({ ...m, files: m.files.filter((f) => !isGeneratedPath(f.path)) }))
    .filter((m) => m.files.length > 0);
}

// ── File tree (collapsible) ─────────────────────────────────────────────────────
function FileTreeView({ brief }: { brief: ProjectBrief }) {
  const root = useMemo(() => buildFileTree(treeInputs(brief)), [brief]);
  // Top-level folders open by default so the structure is visible on arrival.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(root.children.filter((c) => !c.isFile).map((c) => c.path)),
  );
  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const rows: React.ReactNode[] = [];
  const walk = (node: TreeNode, depth: number) => {
    for (const c of node.children) {
      const pad = { paddingLeft: `${depth * 14}px` };
      if (c.isFile) {
        rows.push(
          <li key={c.path} className="flex items-center gap-2 py-0.5" style={pad}>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: CATEGORY_DOT[c.category ?? "other"] }} aria-hidden />
            <span className="truncate text-xs text-fg" title={c.path}>
              {c.name}
            </span>
          </li>,
        );
      } else {
        const isOpen = open.has(c.path);
        rows.push(
          <li key={c.path} style={pad}>
            <button
              type="button"
              onClick={() => toggle(c.path)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-1.5 py-0.5 text-left"
            >
              <span className="w-3 text-fg-dim" aria-hidden>
                {isOpen ? "▾" : "▸"}
              </span>
              <span className="truncate text-xs font-medium text-fg">{c.name}/</span>
              <span className="ml-auto text-[10px] text-fg-dim">{countFiles(c)}</span>
            </button>
          </li>,
        );
        if (isOpen) walk(c, depth + 1);
      }
    }
  };
  walk(root, 0);

  return (
    <section>
      <p className="mb-2 text-xs text-fg-dim">The directory tree. Click a folder to expand or collapse it.</p>
      <ul className="rounded-lg border border-border bg-black/20 p-2">{rows}</ul>
    </section>
  );
}

function countFiles(node: TreeNode): number {
  if (node.isFile) return 1;
  return node.children.reduce((s, c) => s + countFiles(c), 0);
}

// ── Sunburst (radial tree) ───────────────────────────────────────────────────────
function SunburstView({ brief }: { brief: ProjectBrief }) {
  const W = 320;
  const cx = W / 2;
  const cy = W / 2;
  const maxDepth = 4;
  const ring = (W / 2 - 6) / maxDepth;
  const arcs = useMemo(() => buildSunburst(buildFileTree(treeInputs(brief)), maxDepth), [brief]);

  return (
    <section>
      <p className="mb-2 text-xs text-fg-dim">
        The tree as rings: the center is the repo, each ring a folder level, each slice sized by churn.
      </p>
      <svg viewBox={`0 0 ${W} ${W}`} className="mx-auto block h-auto w-full max-w-[340px]" role="img" aria-label="Sunburst of the codebase">
        {arcs.map((a) => {
          if (a.endAngle - a.startAngle < 0.012) return null; // skip slivers
          const r0 = (a.depth - 1) * ring + 6;
          const r1 = a.depth * ring + 6;
          const fill = a.isFile ? CATEGORY_DOT[a.category ?? "other"] : "#39406b";
          return (
            <path
              key={a.path}
              d={arcPath(cx, cy, r0, r1, a.startAngle, a.endAngle)}
              fill={fill}
              stroke="#0b0d1a"
              strokeWidth={0.5}
              opacity={a.isFile ? 0.9 : 0.7}
            >
              <title>{`${a.path || a.name}\n${a.value.toLocaleString()} churn`}</title>
            </path>
          );
        })}
        <circle cx={cx} cy={cy} r={6} fill="#8b5cf6" />
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-dim">
        {([["ui", "UI"], ["logic", "Logic"], ["engine", "Engine"], ["test", "Tests"], ["config", "Config"], ["docs", "Docs"]] as const).map(
          ([cat, label]) => (
            <li key={cat} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: CATEGORY_DOT[cat] }} aria-hidden />
              {label}
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

/** SVG path for an annular sector, angle 0 at the top, clockwise. */
function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const pt = (r: number, a: number) => [cx + r * Math.cos(a - Math.PI / 2), cy + r * Math.sin(a - Math.PI / 2)];
  const [x0, y0] = pt(r1, a0);
  const [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r0, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0},${y0} A${r1},${r1} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 0 ${x3},${y3} Z`;
}

// ── Onboarding ────────────────────────────────────────────────────────────────
function OnboardingTab({ brief }: { brief: ProjectBrief }) {
  return (
    <>
      <Section title="Start here">
        <p className="mb-2 text-xs text-fg-dim">Read these in order to get oriented fast.</p>
        <ol className="space-y-2">
          {brief.readingPath.map((s) => (
            <li key={s.path} className="rounded-lg border border-border bg-black/20 p-3">
              <div className="flex items-baseline gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/25 text-[11px] font-semibold text-fg">
                  {s.order}
                </span>
                <code className="truncate text-xs text-fg" title={s.path}>
                  {s.path}
                </code>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-fg-dim">
                <span className="text-fg">{s.role}.</span> {s.why}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      {brief.firstFiles.length > 0 && (
        <Section title="Good first files">
          <p className="mb-2 text-xs text-fg-dim">Approachable, low-risk places to make a first change.</p>
          <ul className="space-y-1.5">
            {brief.firstFiles.map((f) => (
              <li key={f.path} className="rounded-lg border border-border bg-black/20 p-2.5">
                <code className="block truncate text-xs text-fg" title={f.path}>
                  {f.path}
                </code>
                <span className="text-[11px] text-fg-dim">{f.role} · {f.why}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {brief.coupling.length > 0 && (
        <Section title="Files that change together">
          <p className="mb-2 text-xs text-fg-dim">Edit one and you usually edit the other.</p>
          <CouplingGraph coupling={brief.coupling} />
          <ul className="mt-2 space-y-1.5">
            {brief.coupling.map((c) => (
              <li key={`${c.a}|${c.b}`} className="rounded-lg border border-border bg-black/20 p-2.5">
                <div className="flex items-center gap-1.5 text-xs text-fg">
                  <code className="truncate" title={c.a}>
                    {shortName(c.a)}
                  </code>
                  <span className="text-fg-dim" aria-hidden>
                    ↔
                  </span>
                  <code className="truncate" title={c.b}>
                    {shortName(c.b)}
                  </code>
                  <span className="ml-auto shrink-0 text-[10px] text-fg-dim">
                    {Math.round(c.score * 100)}% · {c.together}×
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

// A circular node-link diagram of temporal coupling: distinct files sit on a
// ring, chords connect co-changing pairs (opacity by coupling strength). Pure,
// deterministic layout from the coupling list.
function CouplingGraph({ coupling }: { coupling: ProjectBrief["coupling"] }) {
  const S = 300;
  const cx = S / 2;
  const cy = S / 2;
  const r = S / 2 - 30;
  const files = Array.from(new Set(coupling.flatMap((c) => [c.a, c.b])));
  if (files.length < 2) return null;
  const pos = new Map<string, { x: number; y: number; a: number }>();
  files.forEach((f, i) => {
    const a = (i / files.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(f, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), a });
  });
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="mx-auto block h-auto w-full max-w-[320px] rounded-lg border border-border bg-black/30" role="img" aria-label="Coupling graph">
      {coupling.map((c) => {
        const p = pos.get(c.a)!;
        const q = pos.get(c.b)!;
        return (
          <line key={`${c.a}|${c.b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#8b5cf6" strokeWidth={1 + c.score * 2} opacity={0.25 + c.score * 0.5}>
            <title>{`${shortName(c.a)} ↔ ${shortName(c.b)} — ${Math.round(c.score * 100)}%`}</title>
          </line>
        );
      })}
      {files.map((f) => {
        const p = pos.get(f)!;
        const anchor = Math.cos(p.a) >= 0 ? "start" : "end";
        const lx = cx + (r + 6) * Math.cos(p.a);
        const ly = cy + (r + 6) * Math.sin(p.a);
        return (
          <g key={f}>
            <circle cx={p.x} cy={p.y} r={3.5} fill="#a78bfa">
              <title>{f}</title>
            </circle>
            <text x={lx} y={ly + 3} fontSize={7} fill="#8b91b3" textAnchor={anchor}>
              {shortName(f)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Health ──────────────────────────────────────────────────────────────────
// ── Team topology ─────────────────────────────────────────────────────────────
function TeamTab({ brief, commitTimeline }: { brief: ProjectBrief; commitTimeline?: CommitTimeline | null }) {
  const t = brief.team;
  const fps = t.fingerprints;
  const multi = fps.length > 1;
  const [openAuthor, setOpenAuthor] = useState<string | null>(null);

  // Scatter: x = avg commit size (surgical → sweeping), y = breadth (dirs).
  const W = 300;
  const H = 170;
  const padL = 26;
  const padB = 22;
  const maxSize = Math.max(1, ...fps.map((f) => f.avgCommitSize));
  const maxDirs = Math.max(1, ...fps.map((f) => f.dirsTouched));
  const px = (f: (typeof fps)[number]) => padL + (f.avgCommitSize / maxSize) * (W - padL - 8);
  const py = (f: (typeof fps)[number]) => H - padB - (f.dirsTouched / maxDirs) * (H - padB - 10);

  return (
    <>
      <section className="rounded-lg border border-border bg-black/20 p-4">
        <div className="text-xs uppercase tracking-wider text-fg-dim">Team topology</div>
        <p className="mt-1 text-xs leading-relaxed text-fg-dim">{t.note}</p>
        {multi && (
          <div className="mt-3">
            <div className="mb-0.5 flex items-baseline justify-between text-xs">
              <span className="text-fg">Concentration</span>
              <span className="text-fg-dim">top {t.concentration.topShare}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/40">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(t.concentration.gini * 100)}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-fg-dim">{t.concentration.note}</p>
          </div>
        )}
      </section>

      {multi && commitTimeline && <DepartureSimulator brief={brief} commitTimeline={commitTimeline} />}

      {multi && (
        <Section title="Work styles">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full rounded-lg border border-border bg-black/30" role="img" aria-label="Contributor work-style scatter">
            {/* axes */}
            <line x1={padL} y1={H - padB} x2={W - 4} y2={H - padB} stroke="#1c2033" strokeWidth={1} />
            <line x1={padL} y1={8} x2={padL} y2={H - padB} stroke="#1c2033" strokeWidth={1} />
            <text x={W - 4} y={H - padB + 14} fontSize={8} fill="#8b91b3" textAnchor="end">sweeping →</text>
            <text x={padL} y={H - padB + 14} fontSize={8} fill="#8b91b3">surgical</text>
            <text x={4} y={14} fontSize={8} fill="#8b91b3">↑ broad</text>
            {fps.map((f) => (
              <g key={f.author}>
                <circle cx={px(f)} cy={py(f)} r={4} fill="#8b5cf6" opacity={0.85}>
                  <title>{`${f.author}\n${f.style}\n${f.avgCommitSize} files/commit · ${f.dirsTouched} folders`}</title>
                </circle>
                <text x={px(f) + 6} y={py(f) + 3} fontSize={8} fill="#e8eaf6">
                  {f.author.split(/[\s@]/)[0]}
                </text>
              </g>
            ))}
          </svg>
        </Section>
      )}

      <Section title="Contributor fingerprints">
        <p className="mb-2 text-xs text-fg-dim">Click a contributor to see what they work on.</p>
        <ul className="space-y-1.5">
          {fps.map((f) => {
            const isOpen = openAuthor === f.author;
            return (
              <li key={f.author} className="overflow-hidden rounded-lg border border-border bg-black/20">
                <button
                  type="button"
                  onClick={() => setOpenAuthor(isOpen ? null : f.author)}
                  aria-expanded={isOpen}
                  className="w-full p-2.5 text-left transition hover:bg-black/20"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium text-fg" title={f.author}>
                      {f.author}
                    </span>
                    <span className="shrink-0 text-[11px] text-accent">{f.style}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-fg-dim">
                    {f.commits} commits · {f.avgCommitSize} files/commit · {f.filesTouched} files · {f.dirsTouched} folders
                    {f.topAreas.length > 0 && <> · {f.topAreas.join(", ")}</>}
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-border/60 px-2.5 py-2 text-[11px] text-fg-dim">
                    <div>
                      Active {fmtDate(f.firstCommit)} – {fmtDate(f.lastCommit)}
                    </div>
                    {f.topFiles.length > 0 && (
                      <>
                        <div className="mt-1.5 font-semibold uppercase tracking-wider text-fg-dim">Most-touched files</div>
                        <ul className="mt-0.5 space-y-0.5">
                          {f.topFiles.map((p) => (
                            <li key={p}>
                              <code className="block truncate text-fg" title={p}>
                                {p}
                              </code>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      {t.brokers.length > 0 && (
        <Section title="Knowledge brokers">
          <p className="mb-2 text-xs text-fg-dim">If these people left, the team would fragment into disconnected areas.</p>
          <div className="flex flex-wrap gap-1.5">
            {t.brokers.map((b) => (
              <span key={b} className="rounded-full bg-accent/20 px-2.5 py-1 text-xs font-medium text-fg">
                {b}
              </span>
            ))}
          </div>
        </Section>
      )}

      {t.silos.length > 1 && (
        <Section title="Possible silos">
          <p className="mb-2 text-xs text-fg-dim">These groups never touch the same files.</p>
          <ul className="space-y-1.5">
            {t.silos.map((group, i) => (
              <li key={i} className="rounded-lg border border-border bg-black/20 p-2.5 text-xs text-fg">
                {group.join(", ")}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {t.links.length > 0 && (
        <Section title="Who collaborates">
          <ul className="space-y-1">
            {t.links.map((l) => (
              <li key={`${l.a}|${l.b}`} className="flex items-center gap-1.5 text-xs">
                <span className="truncate text-fg">{l.a}</span>
                <span className="text-fg-dim" aria-hidden>↔</span>
                <span className="truncate text-fg">{l.b}</span>
                <span className="ml-auto shrink-0 text-[11px] text-fg-dim">
                  {l.sharedFiles} shared · {Math.round(l.jaccard * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

// "Ghost repo" what-if: simulate a contributor's departure by re-folding the
// commit history without them, then diff the resulting brief.
function DepartureSimulator({ brief, commitTimeline }: { brief: ProjectBrief; commitTimeline: CommitTimeline }) {
  const [who, setWho] = useState<string>("");
  const sim = useMemo(
    () => (who ? buildBrief(applyScenario(commitTimeline, { excludeAuthors: [who] })) : null),
    [who, commitTimeline],
  );
  return (
    <Section title="What if someone left?">
      <p className="mb-2 text-xs text-fg-dim">
        Replay history without a contributor to see how health and the team would change.
      </p>
      <select
        value={who}
        onChange={(e) => setWho(e.target.value)}
        aria-label="Simulate departure of"
        className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
      >
        <option value="">Pick a contributor…</option>
        {brief.team.fingerprints.map((f) => (
          <option key={f.author} value={f.author}>
            {f.author}
          </option>
        ))}
      </select>
      {sim && (
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-black/20 p-3">
          <Metric label="Health" before={brief.health.score} after={sim.health.score} suffix="/100" />
          <Metric label="Bus factor" before={brief.risk.busFactor} after={sim.risk.busFactor} />
          <Metric label="Contributors" before={brief.stats.contributors} after={sim.stats.contributors} />
          <Metric label="Live files left" before={brief.stats.filesAlive} after={sim.stats.filesAlive} />
          <p className="pt-1 text-[11px] leading-relaxed text-fg-dim">{departureNote(brief, sim, who)}</p>
        </div>
      )}
    </Section>
  );
}

function Metric({ label, before, after, suffix = "" }: { label: string; before: number; after: number; suffix?: string }) {
  const delta = after - before;
  const color = delta < 0 ? "#fa6666" : delta > 0 ? "#6ee6a0" : "#8b91b3";
  return (
    <div className="flex items-baseline justify-between text-xs">
      <span className="text-fg-dim">{label}</span>
      <span className="flex items-baseline gap-1.5 tabular-nums">
        <span className="text-fg-dim">{before}{suffix}</span>
        <span aria-hidden className="text-fg-dim">→</span>
        <span className="font-medium text-fg">{after}{suffix}</span>
        {delta !== 0 && (
          <span style={{ color }}>
            ({delta > 0 ? "+" : ""}{delta})
          </span>
        )}
      </span>
    </div>
  );
}

function departureNote(base: ProjectBrief, sim: ProjectBrief, who: string): string {
  const parts: string[] = [];
  const lostFiles = base.stats.filesAlive - sim.stats.filesAlive;
  const dHealth = sim.health.score - base.health.score;
  if (base.team.brokers.includes(who)) {
    parts.push(`${who} is a knowledge broker.`);
  }
  if (sim.team.silos.length > base.team.silos.length) {
    parts.push(`The team would fragment into ${sim.team.silos.length} disconnected groups.`);
  }
  if (lostFiles > 0) {
    parts.push(`${lostFiles} file${lostFiles === 1 ? "" : "s"} only ${who} ever touched would lose their sole author.`);
  }
  parts.push(dHealth < 0 ? `Health would fall ${Math.abs(dHealth)} points.` : dHealth > 0 ? `Health would rise ${dHealth} points.` : "Health would be unchanged.");
  return parts.join(" ");
}

function trendVerdict(scores: number[]): string {
  if (scores.length < 2) return "";
  const delta = scores[scores.length - 1] - scores[0];
  if (delta >= 6) return `Health has improved ${delta} points over the project's life.`;
  if (delta <= -6) return `Health has declined ${Math.abs(delta)} points over the project's life.`;
  return "Health has stayed roughly steady over the project's life.";
}

const GRADE_COLOR: Record<string, string> = {
  A: "#6ee6a0",
  B: "#9ae65a",
  C: "#fabe5a",
  D: "#fb921e",
  F: "#fa6666",
};

function HealthTab({ brief }: { brief: ProjectBrief }) {
  const r = brief.risk;
  const h = brief.health;
  const gradeColor = GRADE_COLOR[h.grade] ?? "#8b91b3";
  return (
    <>
      {/* Health score */}
      <section className="rounded-lg border border-border bg-black/20 p-4">
        <div className="flex items-center gap-4">
          <div
            className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-2"
            style={{ borderColor: gradeColor }}
          >
            <span className="text-xl font-bold leading-none" style={{ color: gradeColor }}>
              {h.grade}
            </span>
            <span className="text-[10px] text-fg-dim">{h.score}/100</span>
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-fg-dim">Project health</div>
            <p className="mt-1 text-xs leading-relaxed text-fg-dim">{h.summary}</p>
          </div>
        </div>
        <ul className="mt-3 space-y-1.5">
          {h.factors.map((f) => (
            <li key={f.name}>
              <div className="mb-0.5 flex items-baseline justify-between text-xs">
                <span className="text-fg" title={f.note}>
                  {f.name}
                </span>
                <span className="text-fg-dim">
                  {f.score}/{f.max}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/40">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.round((f.score / f.max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {brief.healthTrend.length > 1 && (
        <Section title="Health over time">
          <div className="flex items-end gap-1.5">
            {brief.healthTrend.map((p) => (
              <div key={p.index} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-20 w-full items-end">
                  <div
                    className="w-full rounded-t"
                    style={{ height: `${Math.max(4, p.score)}%`, background: GRADE_COLOR[p.grade] ?? "#8b91b3" }}
                    title={`${p.label}: ${p.score}/100 (${p.grade})`}
                  />
                </div>
                <span className="text-[9px] font-semibold text-fg-dim">{p.score}</span>
                <span className="w-full truncate text-center text-[9px] text-fg-dim" title={p.label}>
                  {p.label}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-fg-dim">
            {trendVerdict(brief.healthTrend.map((p) => p.score))}
          </p>
        </Section>
      )}

      <section className="rounded-lg border border-border bg-black/20 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-wider text-fg-dim">Bus factor</span>
          <span className="text-2xl font-semibold tabular-nums text-fg">{r.busFactor}</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-fg-dim">{r.busFactorNote}</p>
        {r.keyPerson && (
          <p className="mt-2 text-xs text-fg-dim">
            Top committer: <span className="text-fg">{r.keyPerson.author}</span> ({r.keyPerson.sharePct}% of commits)
          </p>
        )}
      </section>

      {r.notes.length > 0 && (
        <Section title="Findings">
          <ul className="space-y-1.5">
            {r.notes.map((n, i) => (
              <li key={i} className="flex gap-2 text-xs leading-relaxed text-fg-dim">
                <span aria-hidden className="text-accent">
                  •
                </span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {r.ownership.length > 0 && (
        <Section title="Folder ownership">
          <ul className="space-y-1">
            {r.ownership.map((o) => (
              <li key={o.dir} className="flex items-baseline justify-between gap-2 text-xs">
                <code className="truncate text-fg" title={o.dir}>
                  {o.dir}
                </code>
                <span className="shrink-0 text-fg-dim">
                  {o.owner} · {o.sharePct}%
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {r.hotspots.length > 0 && (
        <Section title="Maintenance hotspots">
          <ul className="space-y-1.5">
            {r.hotspots.map((h) => (
              <li key={h.path} className="rounded-lg border border-border bg-black/20 p-2.5">
                <code className="block truncate text-xs text-fg" title={h.path}>
                  {h.path}
                </code>
                <span className="text-[11px] text-fg-dim">{h.note}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {r.stale.length > 0 && (
        <Section title="Possibly stale">
          <p className="mb-2 text-xs text-fg-dim">Live code untouched for the older part of the project&apos;s history.</p>
          <ul className="space-y-1.5">
            {r.stale.map((sf) => (
              <li key={sf.path} className="rounded-lg border border-border bg-black/20 p-2.5">
                <code className="block truncate text-xs text-fg" title={sf.path}>
                  {sf.path}
                </code>
                <span className="text-[11px] text-fg-dim">{sf.note}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-dim">{title}</h3>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-black/20 px-2 py-1.5 text-center">
      <div className="tabular-nums text-sm font-semibold text-fg">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-fg-dim">{label}</div>
    </div>
  );
}
