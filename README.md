# RepoReel

[![CI](https://github.com/KP-MobileTechie/reporeel/actions/workflows/ci.yml/badge.svg)](https://github.com/KP-MobileTechie/reporeel/actions/workflows/ci.yml)

Turn any git repo's history into a cinematic "code galaxy" movie you can scrub and export as video, rendered entirely in your browser with a hand-written WebGL2 engine.

> Live demo: https://reporeel-fawn.vercel.app

<!-- demo gif: owner to record -->

Files are stars (colored by language, sized by churn), directories are gravity clusters, commits are supernovas, contributors are comets, and deletions collapse into black holes. Watch your codebase being born, then export the reel as an MP4.

An on-board **AI Coordinator** reads the same history and explains the repo to anyone who has never opened it, organized into audience tabs:

- **Ask**: a natural-language question box ("Where are the tests?", "Who owns the engine?", "How healthy is it?") that answers instantly from the brief, deterministically, with a keyword-search fallback. Optionally, with your own Anthropic API key (held in memory only), a **grounded AI copilot** writes a fuller answer using the deterministic brief as facts, so it explains the repo and cites files without hallucinating its structure.
- **Overview**: what the project is (a product-type classification: web app, library, CLI, game, backend, mobile, …), the tech stack, project conventions (CI, Docker, monorepo, naming style), fast facts, the story told in chapters (click to jump the galaxy there), notable moments (rewrites, cleanups, feature drops, contributor arrivals and departures, each clickable to seek), who built what, and one-click export.
- **Activity**: the project's pulse: a commit-cadence sparkline, a momentum read (accelerating, steady, slowing, dormant), the work-type mix parsed from commit messages, a commit-hygiene grade with a per-era culture trend, the recent feature highlights, and a language-composition bar.
- **Stats**: detected releases / version bumps, a commit-size distribution, a weekday and hour activity heatmap, the largest folders by churn, and the recently-active files.
- **Deps**: in local mode (where file contents are available), a real module dependency graph parsed from import statements: the core files everything depends on, the most entangled files, import cycles, and isolated files. For demos and GitHub repos it points to the coupling graph instead.
- **Files**: the same codebase in four representations: a searchable directory **list** of every file and its role (with category filter chips), a collapsible **tree**, a squarified treemap **map** (files sized by churn, colored by type), and a radial **sunburst**. Plus the files that matter most and why.
- **Onboarding**: a "start here" reading path (README to entry point to core types to central files, each with a reason), approachable "good first files" for a newcomer's first change, and the files that tend to change together (shown as a circular coupling graph).
- **Team**: contributor fingerprints (work style: surgical vs sweeping, specialist vs generalist) with a per-contributor drill-down (active dates, most-touched files), a work-style scatter, who collaborates, possible silos (groups that never touch the same files), knowledge brokers (people whose departure would fragment the team), and a "what if someone left?" simulator that replays history without a contributor and shows how health, bus factor and the team would change. All from commit metadata, so it works in every mode.
- **Health**: a transparent 0-100 health grade (tests, docs, collaboration, momentum, structure), a health-over-time trend (the grade recomputed at the end of each era), plus the bus factor, key-person risk, per-folder ownership, maintenance hotspots, and possibly-stale files, in plain language for leads and managers.

One click exports the whole brief as a portable `ONBOARDING.md` (or JSON, or copied to the clipboard). The Coordinator's narration also plays as captions under the galaxy and can be burned into the exported video. The two halves connect both ways: click a star in the galaxy to open that file's card (role, churn, importance, risk flags, and the files it changes with), and press `g` to toggle the Coordinator. The open tab is deep-linkable via `?guide=<tab>` (so a shared link opens straight to, say, Health), and a voiceover toggle reads the narration aloud as the timeline plays.

## Embed it

A controls-free embed view renders a looping galaxy and a live health badge for any public repo or demo, fully client-side:

```html
<iframe src="https://reporeel-fawn.vercel.app/embed?demo=reporeel"
        width="640" height="360" style="border:0;border-radius:12px"></iframe>
```

Use `?repo=owner/name` for a GitHub repo. Every embed links back to the full experience.

## Try it

RepoReel has three ways to feed it a repo:

1. **Drop a local `.git` folder.** Parsed in-browser, nothing is uploaded.
2. **Paste a GitHub URL.** Pulled over the REST API; for big repos you can add your own token (rate-limit aware).
3. **Pick a pre-baked demo.** Instant galaxies for reporeel, chalk, linkdeck, dropfour, and splitwisely.

Privacy first: in local mode your repo never leaves the browser, and any GitHub token you paste lives in memory only.

## How it works

### The render engine

Raw WebGL2, no three.js. Every star is drawn as an instanced GPU point sprite, so the whole galaxy goes out in a single draw call with per-instance attributes for position, size, color, and pulse phase. Stars use additive blending so overlapping light accumulates. A custom GLSL bloom pipeline runs a bright-pass then a separable Gaussian blur across ping-pong framebuffers and composites the glow back over the scene. A frame-timer watches FPS and auto-adjusts quality so the engine holds its 60fps target at 10k+ stars.

### The timeline engine

The simulation core is pure, tested functions: a `CommitTimeline` is compiled into per-frame scene events (star births and deaths, supernova ripples, comet trails, per-star growth), and `sceneAtTime` binary-searches that event stream to sample any moment on the scrubber instantly. Star positions come from a force-directed layout that runs in a Web Worker and is seeded deterministically, so the same repo always yields the same galaxy on any machine: shareable and reproducible.

### The AI Coordinator

Contributors and commits show you the motion; the Coordinator tells you the meaning. It is a deterministic, client-side code-intelligence layer (`lib/insights/`) that folds the commit history into a `ProjectBrief` in a single pass. It infers each file's role from naming conventions, detects the stack from marker files and extensions, groups the tree into modules with a one-line purpose each and a full file directory, ranks the most important files (damping auto-generated noise like lockfiles), and segments history into named "eras." On top of that it derives the things that make a codebase approachable: a recommended reading order for newcomers, temporal coupling (files that keep changing together), an activity pulse (commit cadence, momentum, work-type mix from commit messages, recent highlights), a squarified treemap of the whole tree, and a project-health read for leads (a graded 0-100 score, bus factor, per-folder ownership, single-maintainer hotspots). The whole brief exports as an `ONBOARDING.md`. There is no LLM call and no network: the same repo always yields the same brief, so it works on a private local repo that never leaves the browser. The narration is mirrored two ways: as live captions in the theater, and burned into the exported video through a 2D compositing layer (`lib/export/overlay.ts`) that paints an intro title card and lower-third captions over each WebGL frame before it is encoded.

### Privacy

Local repos are parsed in a Web Worker via isomorphic-git, so nothing leaves the browser. There is no backend, no analytics, no cookies, and no sign-up. The optional GitHub token for large repos is held in memory only and is never stored or transmitted anywhere except to GitHub's own API.

## Decisions

- **Raw WebGL2 over three.js.** Hand-writing the renderer gives full control over instancing, the bloom passes, and the GPU trail particles, and it stands as a deliberate engineering proof rather than a wrapper around a library.
- **Hybrid ingestion: local, URL, and demos.** Local parsing dodges GitHub rate limits and gives a real privacy story, URL mode keeps instant gratification, and pre-baked demos make the landing page light up with zero setup.
- **Deterministic seeded layout.** A seeded force simulation means a given repo always produces the same galaxy, so galaxies are reproducible and links are shareable.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # vitest run (317 tests)
npm run build    # static export to ./out
```

## Stack

Next.js 16 (static export) + TypeScript + Tailwind v4 + hand-written WebGL2 + Web Workers + isomorphic-git + mp4-muxer, tested with Vitest. Export uses WebCodecs MP4 with a MediaRecorder WebM fallback. Static, client-side, $0 to run.

## Bake your own demo

You can turn any local git repo into a pre-baked demo galaxy:

```bash
node scripts/bake-demo.mjs <path-to-local-git-repo> <id> <label> [maxCommits=3000]
# example:
node scripts/bake-demo.mjs D:/Projects/reporeel reporeel "RepoReel"
```

This writes `public/demos/<id>.json` and registers it in the demo manifest.

## Generate ONBOARDING.md from CI

The same insight engine runs headless, so any repo can keep a fresh onboarding guide in version control with no backend:

```bash
npm run onboarding            # writes ONBOARDING.md for the current repo
node scripts/generate-onboarding.mjs <repoPath> <outFile> [maxCommits]
```

It walks `git log`, builds the brief, and writes Markdown. Copy `.github/workflows/onboarding.yml` into any repo to regenerate the guide on each release (it commits the file only when it changed). This is the distribution play: every repo that adopts it advertises RepoReel in its README.

## License

MIT, see [LICENSE](LICENSE).
