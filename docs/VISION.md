# RepoReel: Vision and Roadmap

_Last updated: 2026-06-14_

RepoReel turns any git repository into two things at once: a cinematic "code galaxy" you can scrub and export as video, and an AI Coordinator that explains the whole codebase to anyone who has never opened it. This document records what RepoReel does today and lays out the path to making it a top 0.001% project: not just feature-rich, but category-defining.

---

## 1. Where we are today

### The galaxy (visualization)

A hand-written WebGL2 engine (no three.js) renders the repo's history as a living galaxy:

- Files are stars, colored by language and sized by churn.
- Directories are gravity clusters; commits are supernovas; contributors are comets; deletions collapse into black holes.
- A deterministic, seeded force layout (in a Web Worker) means the same repo always yields the same galaxy: reproducible and shareable.
- A custom GLSL bloom pipeline and an FPS auto-tuner hold 60fps at 10k+ stars.
- Three ingestion modes: a local `.git` folder (parsed in-browser, nothing uploaded), a GitHub URL, or a pre-baked demo.
- Export to MP4 (WebCodecs) or WebM (MediaRecorder fallback), with shareable links.

### The AI Coordinator (understanding)

A deterministic, client-side code-intelligence layer (`lib/insights/`) folds the same commit history into a `ProjectBrief` and presents it in six audience tabs:

- **Ask**: a natural-language question box ("Where are the tests?", "Who owns the engine?", "How healthy is it?") answered from the brief, with a keyword-search fallback. No LLM.
- **Overview**: a product-type classification (web app, library, CLI, game, backend, mobile, data/ML, docs site), the tech stack, the story in chapters, who built what, and export to Markdown / JSON / clipboard.
- **Activity**: a commit-cadence sparkline, a momentum read (accelerating, steady, slowing, dormant), a work-type breakdown parsed from commit messages, recent highlights, and a language-composition bar.
- **Files**: the same tree in four representations: a searchable directory list with category filters, a collapsible tree, a squarified treemap, and a radial sunburst. Plus the files that matter most and why.
- **Onboarding**: a "start here" reading path with reasons, and the files that change together (temporal coupling).
- **Health**: a transparent 0-100 grade (tests, docs, collaboration, momentum, structure), bus factor, key-person risk, per-folder ownership, maintenance hotspots, and possibly-stale files.

The Coordinator's narration also plays as live captions under the galaxy and can be burned into the exported video.

### Foundations (the architecture we will protect)

- **Deterministic**: same repo, same output, every time, on any machine.
- **Client-side and $0**: no backend, no analytics, no sign-up, nothing to run.
- **Privacy-first**: local repos never leave the browser; any GitHub token lives in memory only.
- **Tested**: a large, pure insight layer with broad unit coverage (278+ tests).

---

## 2. What "top 0.001%" means here

Most repo-visualization tools are either pretty-but-shallow (an animation with no insight) or insightful-but-ugly (a dashboard of charts). RepoReel already sits in a rare overlap: it is beautiful AND it explains. Reaching the top 0.001% is not about piling on charts. It is three things:

1. **Truth**: answer real questions a developer, lead, or newcomer actually asks, and be correct.
2. **Reach**: be where people already are (the README, the PR, the editor), not only on our site.
3. **Singularity**: do something no other tool can, defensibly. Our moat is the combination of a real rendering engine, a deterministic insight layer, and a zero-backend privacy story.

The roadmap below is organized to push on all three.

---

## 3. The moat (what we must not break)

Every proposed feature is measured against these. A feature that breaks one needs an extraordinary reason.

- **No backend, $0 to run.** The moment we need a server, we lose the "drop any repo, nothing uploaded" promise and the zero-cost story.
- **Privacy.** Local repos stay local. We never phone home.
- **Determinism.** Reproducibility is what makes galaxies shareable and tests trustworthy.
- **Test-first insight layer.** Every insight is a pure, tested function before it is a pixel.

---

## 4. Roadmap

### Tier 1: Near-term, high leverage (fits the architecture as-is)

1. **Click a star to inspect a file.** [SHIPPED] Clicking a star hit-tests the rendered positions and opens that file's role, churn, importance, risk flags and co-change partners. Connects the galaxy to the Coordinator.
2. **Deep links and shareable Coordinator state.** [SHIPPED] `?guide=<tab>` opens the Coordinator straight to a tab, reflected in the URL as you navigate.
3. **Command palette.** A "/" anywhere focuses Ask; arrow-key navigation across files, modules, and contributors. Keyboard-first feels pro and speeds everything up.
4. **Health over time.** [SHIPPED] The health grade is recomputed cumulatively at the end of each era and drawn as a trend in the Health tab.
5. **Per-contributor drill-down.** Click a contributor to see their owned files, areas, first/last commit, and the eras they drove.

### Tier 2: Differentiators (deeper, more effort, still no backend)

6. **A real dependency graph in local mode.** [SHIPPED] In local mode the worker reads HEAD source contents and the Deps tab parses `import`/`require`/`from` into a real dependency graph (core files, most-entangled files, import cycles, isolated files). Falls back to the coupling graph for GitHub/demo mode. (The local-contents read is browser-only plumbing; verify on a real repo.)
7. **Maintainer-authored guided tours.** Let a repo owner script an onboarding walkthrough (a sequence of files, captions, and camera moves) and save it as a shareable URL/JSON. New contributors press play and get a narrated tour of exactly what matters. This turns RepoReel from a viewer into an onboarding medium.
8. **Folder-zoom treemap and galaxy.** Click a module to zoom the treemap (and recenter the galaxy) into just that subtree, with breadcrumbs back out. Makes large repos navigable.
9. **GitHub overlay.** In GitHub mode, surface open PRs and issues as live markers (incoming comets, pulsing stars), so the galaxy shows not just history but the present front line of work.
10. **Voiceover.** [PARTIAL] A live voiceover toggle reads the narration aloud as the timeline plays (Web Speech API, client-side, free). Muxing the spoken audio into the exported MP4 is the remaining piece (speechSynthesis does not expose a capturable stream in most browsers).

### Tier 3: Category-defining and distribution

11. **Embeddable widget and live badge.** [SHIPPED] An `/embed` route renders a controls-free looping galaxy with a live health badge for any public repo or demo, embeddable via `<iframe>`, fully client-side. A `<script>` auto-embed snippet is the remaining nice-to-have.
12. **A GitHub Action.** A zero-backend-for-us Action (it runs in the user's CI) that regenerates `ONBOARDING.md`, commits a health-delta comment on each release, and refreshes the embeddable badge. Meets developers in their existing workflow without us hosting anything.
13. **Editor extension.** A VS Code / JetBrains panel that shows the Coordinator for the currently open repo, with click-through to files. Brings the understanding layer into the place developers live.
14. **Org and multi-repo view.** A galaxy of repositories for an organization, sized by activity, with a roll-up health and ownership view. The manager's command center.
15. **Offline desktop app.** A Tauri shell so RepoReel runs as a native, fully offline tool for private or air-gapped codebases, reinforcing the privacy moat.

---

## 5. The next five (recommended order)

If we do nothing else, do these, in this order. Each is high-impact, fits the architecture, and builds on the last.

1. Click a star to inspect a file (Tier 1.1): unifies the product.
2. Deep links and shareable state (Tier 1.2): makes sharing real, feeds distribution.
3. Health over time (Tier 1.4): turns a snapshot into a story leads care about.
4. Dependency graph in local mode (Tier 2.6): the defensible, can't-copy-this feature.
5. Embeddable widget and badge (Tier 3.11): the distribution flywheel that drives reach.

---

## Shipped since this doc was written

Beyond the original feature set, RepoReel now also includes: a product-type classification; four file representations (list, tree, treemap with folder-zoom, sunburst) with category filters; an "Ask the repo" question box; an Activity tab (cadence, momentum, work-type mix, commit-hygiene/culture grade with trend, highlights, languages); a Stats tab (release detection, commit-size distribution, weekday/hour activity heatmap, largest folders, recently-active files); a graded health score with a health-over-time trend; stale-file detection; full contributor fingerprinting and team topology with per-contributor drill-down, ownership concentration (Gini), silos and articulation-point knowledge brokers; a "ghost repo" what-if departure simulator; notable-events detection (rewrites, cleanups, feature drops, contributor arrivals/departures); project-conventions detection (CI, Docker, monorepo, naming style); a domain-vocabulary glossary; approachable "good first files" suggestions; a circular coupling graph; and click-a-star-to-inspect that connects the galaxy to the Coordinator (plus a `g` keyboard toggle). Tier 1.1 (click a star) and Tier 1.4 (health over time) from the roadmap below are now shipped. The what-if simulator and health-over-time are concrete payoffs of the "analysis is a pure fold" property: both are uniquely possible because we can rewind and replay history deterministically with no backend.

## 6. Non-goals

- **A hosted service or accounts.** Breaks the moat. If hosting is ever needed, it must be optional and the local/zero-backend path stays first-class.
- **An LLM dependency for core insight.** The Coordinator is deterministic on purpose. An optional, user-keyed LLM enrichment could sit on top one day, but it must never be required and must never see private code without explicit, in-session consent.
- **Generic chart dashboards.** We are not a BI tool. Every view must earn its place by answering a question better than a table would.

---

## 7. How we will know it worked

- A newcomer can answer "what is this and where do I start" in under two minutes, from RepoReel alone.
- A lead can assess a repo's health and risk without reading the code.
- Repo owners embed the badge because it makes their project look understood and cared for.
- The dependency graph and guided tours are things people screenshot and share because nothing else does them this well.
