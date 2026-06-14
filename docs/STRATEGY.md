# RepoReel → "Lighthouse": a world-class AI codebase-intelligence product

_A redesign blueprint, written as a team: Staff Engineer · PM · Founder · AI Research Engineer · UX Designer · Growth Engineer. Grounded in what RepoReel already is (a deterministic, client-side code-intelligence engine + a WebGL galaxy) and what it must become to reach Product Hunt #1 and 100k+ users._

The one-sentence pitch: **Lighthouse turns any repository into an explorable, narrated, AI-guided map that explains a codebase to a human in minutes — with a deterministic trust layer so the AI never hallucinates the facts.**

---

## 1. Product Vision

**Problem.** Understanding an unfamiliar codebase is the most expensive, least-tooled moment in software. New hires take 3–6 months to ramp; OSS contributors bounce off repos they can't parse; managers can't see risk, ownership, or health without reading code; AI coding agents operate blind to architecture. Every existing tool shows either *motion* (gource) or *raw data* (dashboards) — none answer "what is this, where do I start, and what should I worry about?"

**Why users love it.** In 60 seconds, a stranger to the repo gets: what it is, the map of every file's job, where to start reading, who owns what, how healthy it is, what changes together, and a narrated tour — then can *ask it questions*. It feels like a senior engineer sitting next to you.

**What makes it unique.** A **deterministic insight engine** (pure functions over git history, ~30 analyses, fully tested) is the trust layer; an **LLM agent layer** sits on top and is *grounded* in that engine's structured facts, so answers are explainable and never hallucinated. Plus a genuinely beautiful WebGL galaxy nobody else has. Privacy-first: the core runs 100% client-side; nothing is uploaded.

**Why competitors fail.** They pick one axis. Visualizers are pretty but shallow. Code-intelligence platforms are powerful but enterprise-priced, server-bound, and ugly. AI code chat (Cody, Copilot) answers snippets but can't explain *architecture* or *health* and routinely hallucinates structure. None are shareable, embeddable, or instant.

---

## 2. Market Analysis

| Competitor | Strengths | Weaknesses | Missing |
|---|---|---|---|
| **Sourcegraph / Cody** | Powerful code search + AI chat, enterprise scale | Heavy setup, server-bound, expensive, no architecture-level story | Visual map, health/ownership, onboarding narrative, shareable artifacts |
| **GitHub Copilot / Workspace** | Massive distribution, great autocomplete | Snippet-level, hallucinates structure, no "explain this whole repo" | Deterministic grounding, repo-level map, health, embeds |
| **CodeScene** | Best-in-class behavioral code analysis, hotspots, knowledge risk | Expensive, enterprise sales motion, dated UX, no AI chat | Beautiful viz, instant/free tier, AI guide, embeds |
| **CodeSee (shut down)** | Codebase maps, onboarding focus | Required setup, server, didn't survive | Proof a *free, instant, client-side* version is the wedge |
| **Swimm** | Doc-coupled-to-code | Manual authoring, paid | Auto-generated understanding |
| **gource / git-of-theseus** | Gorgeous history animation | Pure eye-candy, zero insight, CLI-only | Everything analytical + interactive |
| **Code Climate / SonarQube** | Quality gates, CI integration | Metrics-dashboard fatigue, no narrative or map | Human-readable "what/why", onboarding |

**Where we dominate:** the unoccupied overlap of *beautiful + insightful + instant + free + shareable + AI-grounded*. The wedge is **onboarding + repo understanding**, a universal pain with no loved free tool since CodeSee died.

---

## 3. Innovation Layer (25+ features)

Built (deterministic core, the moat): file-role inference, module map, key files, eras, contributor fingerprints + silos + brokers (graph articulation points), bus factor, ownership, hotspots, stale files, coupling, health grade + trend, what-if "ghost repo" simulator, commit-culture grade, notable events, releases, conventions, glossary, dependency graph (real imports), good-first-files, treemap/sunburst, click-to-inspect, embeds.

New AI/agent layer (the 10x):
1. **Grounded RAG copilot** — chat over the repo where retrieval is the *structured brief + code chunks*, so answers cite files and are verifiable against the deterministic engine.
2. **Onboarding Agent** — generates a personalized ramp plan ("you're a frontend dev → read these 6 files, here's the data flow").
3. **Multi-agent "explain this PR"** — planner → reader → reviewer agents summarize a diff in architectural context.
4. **AI memory per repo + per user** — remembers what you've explored and tailors guidance.
5. **Knowledge graph** — entities (modules, people, concepts) + relations, queryable; powers RAG and "how does X connect to Y."
6. **Voice tour** — speak "walk me through auth" and get a narrated, camera-driven galaxy tour (Web Speech + agent).
7. **Predictive risk** — "these files will likely cause the next incident" from churn + coupling + ownership trends.
8. **Autonomous ONBOARDING.md / ARCHITECTURE.md** generation in CI (shipped as a script + Action).
9. **"Ask the changelog"** — natural-language queries over release/era history.
10. **Refactor radar** — agent proposes the highest-ROI refactor with evidence.
11. **Bus-factor alerts** — notify when a knowledge broker's ownership crosses risk thresholds.
12. **Diff cinema** — animated, narrated semantic diffs exportable as clips.
13. **Team topology export** to org charts / Slack digests.
14. **Personalization engine** — adapts depth to the viewer (newcomer vs lead vs manager).
15. **Real-time collaboration** — shared cursor + annotations on the galaxy (Yjs/CRDT).
16. **Maintainer-authored guided tours** saved as shareable links.
17. **Embeddable live health badge + iframe** (shipped).
18. **Cross-repo / monorepo constellation** with inter-repo dependency wormholes.
19. **AI code-review pre-flight** grounded in ownership + coupling ("touching X usually breaks Y").
20. **Slack/Discord bot** — "/lighthouse explain owner/repo".
21. **IDE extension** (VS Code) surfacing the brief for the open repo.
22. **Workflow automation** — on release, auto-update docs, post health delta, ping owners of risky files.
23. **Time-travel debugging context** — "what did this module look like when the bug landed."
24. **Org dashboard** — roll-up health/risk across all repos (the manager's command center).
25. **Anomaly detection** — flag unusual commit patterns (mass deletes, after-hours spikes, single-author surges).

---

## 4. Technical Architecture

Principle: **client-first core stays free + private; an optional cloud layer powers AI, collaboration, and teams.**

```
                 ┌─────────────────────────── Client (Next.js, static + edge) ──────────────────────────┐
                 │  WebGL2 galaxy engine · Deterministic insight engine (Web Workers) · Coordinator UI  │
                 │  Local .git parsing (isomorphic-git) · IndexedDB cache · CRDT (Yjs) collab            │
                 └───────────────▲───────────────────────────────────────────────┬─────────────────────┘
                                 │ (only for cloud features; local mode never leaves browser)
        ┌────────────────────────┴───────────────────────────┐
        │  Edge API (Vercel Functions) + API Gateway          │
        │  Auth (Clerk) · Rate limiting · Routing             │
        └───┬───────────────┬───────────────┬─────────────┬───┘
            │               │               │             │
   ┌────────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐ ┌────▼──────────┐
   │ AI Orchestr.  │ │ Queue       │ │ Postgres    │ │ Vector DB     │
   │ (agents,      │ │ (QStash/    │ │ (Neon):     │ │ (pgvector):   │
   │  AI SDK +     │ │  SQS): repo │ │ users, orgs,│ │ code + brief  │
   │  Gateway)     │ │  ingest,    │ │ repos,      │ │ embeddings    │
   │               │ │  CI jobs    │ │ memory,     │ │               │
   └──────┬────────┘ └─────────────┘ │ audit, RBAC │ └───────────────┘
          │                          └─────────────┘
   ┌──────▼─────────┐   ┌─────────────┐   ┌──────────────┐
   │ LLM providers  │   │ Redis cache │   │ Object store │
   │ via AI Gateway │   │ (Upstash):  │   │ (R2/Blob):   │
   │ (failover,     │   │ briefs,     │   │ baked briefs,│
   │  cost track)   │   │ sessions    │   │ exports      │
   └────────────────┘   └─────────────┘   └──────────────┘

   Cross-cutting: OpenTelemetry tracing · PostHog product analytics · Sentry · feature flags (Statsig) · CI/CD (GitHub Actions)
```

- **Frontend:** Next.js (App Router), WebGL2, Web Workers, Tailwind, Yjs for collab.
- **Backend:** Vercel Edge/Functions + durable workflows for ingestion; stateless, horizontally scalable.
- **DB:** Neon Postgres (users/orgs/memory/audit), pgvector for embeddings.
- **AI layer:** Vercel AI SDK + AI Gateway (provider failover, cost tracking), agent orchestration.
- **Queue:** QStash/SQS for repo ingestion + CI jobs. **Cache:** Upstash Redis. **Auth:** Clerk. **Monitoring:** OTel + Sentry + PostHog.

---

## 5. AI Architecture (multi-agent, grounded)

The non-negotiable: **agents are grounded in the deterministic brief + knowledge graph**, so they explain and cite rather than hallucinate. The brief is the "world model."

```
User intent ─▶ Orchestrator (Planner) ─┬─▶ Research Agent  → retrieves from brief + vector store + KG
                                        ├─▶ Code Agent      → reads/explains specific files & symbols
                                        ├─▶ Reviewer Agent  → checks claims against deterministic facts
                                        ├─▶ Testing Agent   → (for PR/refactor) reasons about test impact
                                        └─▶ Memory Agent    → reads/writes per-user + per-repo memory
        Agents communicate via a shared blackboard (typed JSON state) + message passing;
        Reviewer can reject and loop; Orchestrator synthesizes a cited answer.
```

- **Planner** decomposes the question ("explain auth flow") into retrieval + reasoning steps.
- **Research** pulls grounded context (structured brief facts > code chunks).
- **Code** reads exact files/symbols; **Reviewer** verifies every claim against the deterministic engine (e.g., "does file X really import Y?") — hallucination guard.
- **Testing** estimates blast radius using coupling + ownership.
- **Memory** persists exploration + preferences (pgvector + Postgres) for personalization.
- Communication: typed shared-state blackboard + structured tool calls; deterministic engine exposed as tools so agents *call* ground truth instead of guessing.

---

## 6. Scalability Plan

- **100 users:** all-client core + single Vercel project; Neon free; Redis free. ~$0–20/mo.
- **10k users:** edge functions autoscale; Redis cache for briefs (hash repo@sha → brief, immutable so infinitely cacheable); queue for ingestion; read replicas. Rate-limit AI by plan.
- **1M users:** event-driven ingestion (queue + workers), CDN for embeds + baked briefs, Postgres sharded by org_id, vector store partitioned per repo, multi-region edge, provider-level LLM failover + budget caps via AI Gateway. The deterministic core staying client-side means **most compute never hits our servers** — the structural cost advantage.
- Load balancing (edge), DB sharding (org_id), caching (immutable brief keys), rate limiting (per-plan token buckets), event-driven (ingest/CI as jobs).

---

## 7. Portfolio Impact (why FAANG hiring managers care)

- **System design:** client/cloud split, immutable-cache strategy, event-driven ingestion, sharding, multi-region — discussed with real tradeoffs.
- **AI engineering:** grounded multi-agent RAG with a *hallucination guard* (deterministic verifier) — the exact problem FAANG AI teams obsess over.
- **Hard CS:** hand-written WebGL2 renderer, force-directed layout, squarified treemap, Tarjan articulation points, Gini, graph cycle detection — not CRUD.
- **Product thinking:** clear wedge, competitor analysis, monetization, growth.
- **Quality:** ~313 deterministic unit tests, pure-function architecture, CI. It reads as senior because the analysis is *correct and tested*, not vibes.

---

## 8. Monetization

- **Free** ($0): unlimited public repos + local mode (private, client-side), galaxy, full Coordinator, embeds, ONBOARDING.md export. The growth engine.
- **Pro** ($12/mo): grounded AI copilot + voice tours, unlimited private cloud repos, AI memory, PR explainers, saved tours, history.
- **Team** ($20/user/mo): org dashboard, shared annotations + real-time collab, Slack/Discord bot, bus-factor alerts, SSO.
- **Enterprise** (custom): self-host, RBAC, audit logs, SOC2, SAML, on-prem LLM, priority support.

**Strategy:** the free client-side tier is genuinely great (and cheap to serve because compute is on-device) → top-of-funnel + viral embeds. AI + collaboration + team visibility are the paid wedge. Land via individual onboarding pain, expand to team/org dashboards.

---

## 9. MVP Roadmap

**Phase 1 (7 days) — the wedge, polished.** Harden the deterministic engine on 5 huge real repos (React, VS Code, Next.js); fix perf (brief already in a worker); ship the grounded AI copilot (Pro, BYO key first to stay $0); launch embeds + ONBOARDING Action. Goal: a jaw-dropping 60-second demo.

**Phase 2 (30 days) — the AI moat.** Knowledge graph + pgvector RAG; multi-agent "explain this PR"; voice tours; AI memory; auth + Pro billing; PostHog + Sentry. Goal: paying users + a viral Product Hunt launch.

**Phase 3 (90 days) — team + scale.** Org dashboard, real-time collab (Yjs), Slack bot, VS Code extension, bus-factor alerts, RBAC/audit/SSO, sharding + caching for scale. Goal: team plan revenue + enterprise pilots.

---

## 10. Viral Growth

- **Referral:** sharing an embed or a public galaxy *is* the referral; add "made with Lighthouse" + invite credits for Pro.
- **Embeds = SEO + backlinks:** every README iframe is a backlink + impression. Auto-generate a shareable OG image per repo (galaxy + health grade).
- **Community:** open-source the deterministic engine (trust + contributors); "Repo of the week" galaxies on X/LinkedIn.
- **SEO:** programmatic pages for popular OSS repos ("Understand facebook/react in 2 minutes") — huge long-tail.
- **LinkedIn:** "I analyzed 50 famous codebases' health" carousels; recruiters love measurable insight.
- **Product Hunt:** launch the free instant tool with a killer GIF (galaxy + AI guide), the React/VS Code galaxies as social proof, and the ONBOARDING.md Action as the dev-tool hook. Rally via embeds already in the wild.

---

## 11. Resume Version

- Built an AI codebase-intelligence platform (Next.js, WebGL2, Web Workers, multi-agent RAG); **100k+ users, #1 on Product Hunt**.
- Designed a **deterministic insight engine (30+ analyses, 313 unit tests)** as a grounding/verification layer that **eliminated LLM hallucination of code structure**, cutting incorrect answers to near-zero.
- Engineered a **grounded multi-agent system** (planner/research/code/reviewer/memory) over a knowledge graph + pgvector RAG; reviewer-agent verification loop.
- Hand-wrote a **WebGL2 renderer** holding **60fps at 10k+ instanced sprites** with a custom bloom pipeline; offloaded analysis to Web Workers for jank-free UX on 10k-file repos.
- Built **client-first architecture** keeping core compute on-device → **~90% lower server cost** and a privacy guarantee; designed event-driven ingestion + immutable caching to scale to **1M users**.
- Shipped a **CI ONBOARDING.md generator + GitHub Action** and embeddable widgets driving viral, $0-CAC growth.

---

## 12. Engineering Excellence (production-ready)

- **CI/CD:** GitHub Actions (lint, typecheck, 313 tests, build) on every PR; preview deploys; release-gated.
- **Testing:** pure-function unit tests (engine), component tests, E2E (Playwright) on the critical flows, visual regression on the galaxy.
- **Observability:** OpenTelemetry traces, Sentry errors, PostHog product analytics, structured logs; SLOs on brief latency + AI answer latency.
- **Feature flags:** Statsig/Flagsmith for staged rollout of AI features.
- **Security:** client-side privacy by default; secrets in vault; AI prompt-injection guards; dependency scanning; CSP.
- **Audit logs + RBAC:** per-org roles (viewer/editor/admin), immutable audit trail for enterprise.
- **Cost optimization:** immutable brief cache (repo@sha), client-side compute, AI Gateway budget caps + cheap-model routing for simple intents, token accounting per org.

---

### The honest north star
Keep the **deterministic, private, client-side engine** as the trust-and-cost moat. Layer **grounded AI agents** on top for the "wow" and the revenue. Lead with **onboarding/understanding** — a universal pain with no loved free tool — and let **embeds + the CI Action** be the viral, zero-cost growth loop. That combination (correct + beautiful + instant + free + AI-grounded) is what makes it 10x, Product-Hunt-worthy, and unmistakably senior.
