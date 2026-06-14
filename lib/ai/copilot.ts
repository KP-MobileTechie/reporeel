// ---------------------------------------------------------------------------
// ai/copilot.ts — the grounded AI copilot. The deterministic ProjectBrief is
// serialized into the prompt as ground truth, and the model is instructed to
// answer ONLY from those facts and cite file paths — so it explains the repo
// without hallucinating its structure. BYO API key (held in memory only),
// keeping the product $0 and private: nothing is sent anywhere unless the user
// opts in with their own key.
//
// `buildGroundedPrompt` is pure and unit-tested; `askAnthropic` is a thin,
// browser-only fetch wrapper (not unit-tested, like the other network adapters).
// ---------------------------------------------------------------------------

import type { ProjectBrief } from "@/lib/insights/types";

export interface GroundedPrompt {
  system: string;
  user: string;
}

/** Serialize the brief into a compact, factual context block for grounding. */
export function briefContext(b: ProjectBrief): string {
  const L: string[] = [];
  L.push(`PROJECT: ${b.name} (${b.projectType.type})`);
  L.push(`SUMMARY: ${b.summary.replace(/`/g, "")}`);
  L.push(`STACK: ${b.techStack.map((t) => t.name).join(", ")}`);
  L.push(
    `STATS: ${b.stats.totalCommits} commits, ${b.stats.filesAlive} files, ${b.stats.contributors} contributors; health ${b.health.score}/100 (${b.health.grade}); bus factor ${b.risk.busFactor}.`,
  );
  L.push("MODULES:");
  for (const m of b.modules.slice(0, 12)) L.push(`- ${m.dir}: ${m.purpose.replace(/`/g, "")}`);
  L.push("KEY FILES:");
  for (const f of b.keyFiles) L.push(`- ${f.path} — ${f.role} (${f.reason})`);
  L.push("READING ORDER:");
  for (const s of b.readingPath) L.push(`- ${s.path}: ${s.why}`);
  if (b.coupling.length) {
    L.push("FILES THAT CHANGE TOGETHER:");
    for (const c of b.coupling.slice(0, 8)) L.push(`- ${c.a} <-> ${c.b} (${Math.round(c.score * 100)}%)`);
  }
  L.push("CONTRIBUTORS:");
  for (const c of b.contributors) L.push(`- ${c.author}: ${c.commits} commits, focus ${c.focus}`);
  if (b.risk.hotspots.length) {
    L.push("HOTSPOTS:");
    for (const h of b.risk.hotspots) L.push(`- ${h.path} (${h.note})`);
  }
  if (b.eras.length) {
    L.push("ERAS:");
    for (const e of b.eras) L.push(`- ${e.label}: ${e.summary.replace(/`/g, "")}`);
  }
  if (b.glossary.length) L.push(`VOCABULARY: ${b.glossary.map((g) => g.term).join(", ")}`);
  return L.join("\n");
}

const SYSTEM = `You are the RepoReel Coordinator, a senior engineer explaining a codebase to someone new to it.
You are given FACTS derived deterministically from the repository's git history. Rules:
- Answer ONLY from the FACTS. Do not invent files, people, or relationships.
- Cite specific file paths in backticks when relevant.
- If the FACTS don't cover the question, say so plainly and suggest what in the repo to look at.
- Be concise and concrete. Prefer specifics from the FACTS over generic advice.`;

/** Build a grounded system+user prompt for a single question (used in tests
 *  and the single-turn `askAnthropic` path). */
export function buildGroundedPrompt(brief: ProjectBrief, question: string): GroundedPrompt {
  return {
    system: SYSTEM,
    user: `FACTS about ${brief.name}:\n\n${briefContext(brief)}\n\nQUESTION: ${question.trim()}`,
  };
}

/** A single turn in the copilot conversation. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** The constant grounding for a multi-turn conversation: the rules plus the
 *  deterministic FACTS, kept in the system prompt so every follow-up stays
 *  grounded without re-sending the facts in each user turn. */
export function groundedSystem(brief: ProjectBrief): string {
  return `${SYSTEM}\n\nFACTS about ${brief.name}:\n${briefContext(brief)}`;
}

export interface AskOptions {
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
}

/**
 * Call Anthropic's Messages API directly from the browser with a user-supplied
 * key. Returns the assistant's text. Throws on HTTP / network errors. The key
 * is never stored by RepoReel; it lives only in memory for this call.
 */
export async function askAnthropic(prompt: GroundedPrompt, opts: AskOptions): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: opts.model || "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (data.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();
}

/**
 * Pure SSE parser: given a chunk of complete event lines from Anthropic's
 * streaming Messages API, return the text deltas in order. Unit-tested; the
 * stream reader below buffers partial lines and feeds complete ones here.
 */
export function extractTextDeltas(eventText: string): string[] {
  const out: string[] = [];
  for (const line of eventText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const json = trimmed.slice(5).trim();
    if (!json || json === "[DONE]") continue;
    try {
      const evt = JSON.parse(json) as { type?: string; delta?: { type?: string; text?: string } };
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
        out.push(evt.delta.text);
      }
    } catch {
      /* incomplete / non-JSON keepalive line */
    }
  }
  return out;
}

/**
 * Stream a grounded answer from Anthropic, invoking `onText` with each text
 * delta as it arrives. Browser-only (uses fetch + ReadableStream). Falls back
 * to nothing special on error — the caller handles it.
 */
export async function streamAnthropic(system: string, messages: ChatMessage[], opts: AskOptions, onText: (delta: string) => void): Promise<void> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: opts.model || "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      stream: true,
      system,
      messages,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lastNl = buf.lastIndexOf("\n");
    if (lastNl >= 0) {
      const complete = buf.slice(0, lastNl);
      buf = buf.slice(lastNl + 1);
      for (const t of extractTextDeltas(complete)) onText(t);
    }
  }
  for (const t of extractTextDeltas(buf)) onText(t);
}

// ── Google Gemini ───────────────────────────────────────────────────────────

/** Detect the provider from the key shape. Anthropic keys start with `sk-ant`;
 *  Google AI Studio (Gemini) keys start with `AIza`. */
export function pickProvider(apiKey: string): "anthropic" | "gemini" {
  return apiKey.trim().startsWith("sk-ant") ? "anthropic" : "gemini";
}

/** Pure parser for Gemini's SSE (`alt=sse`) stream → text deltas. */
export function extractGeminiTextDeltas(eventText: string): string[] {
  const out: string[] = [];
  for (const line of eventText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const json = trimmed.slice(5).trim();
    if (!json || json === "[DONE]") continue;
    try {
      const evt = JSON.parse(json) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      for (const part of evt.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) out.push(part.text);
      }
    } catch {
      /* incomplete / non-JSON line */
    }
  }
  return out;
}

/** Stream a grounded answer from Gemini (Google AI Studio), invoking `onText`. */
export async function streamGemini(system: string, messages: ChatMessage[], opts: AskOptions, onText: (delta: string) => void): Promise<void> {
  const model = opts.model || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(opts.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      // Gemini uses "model" for the assistant role.
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: 1024 },
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${detail.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lastNl = buf.lastIndexOf("\n");
    if (lastNl >= 0) {
      const complete = buf.slice(0, lastNl);
      buf = buf.slice(lastNl + 1);
      for (const t of extractGeminiTextDeltas(complete)) onText(t);
    }
  }
  for (const t of extractGeminiTextDeltas(buf)) onText(t);
}

/** Route a grounded streaming request to the right provider by key shape. */
export async function streamCopilot(system: string, messages: ChatMessage[], opts: AskOptions, onText: (delta: string) => void): Promise<void> {
  return pickProvider(opts.apiKey) === "anthropic"
    ? streamAnthropic(system, messages, opts, onText)
    : streamGemini(system, messages, opts, onText);
}
