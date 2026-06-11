# RepoReel — Design Spec

**Date:** 2026-06-12 · **Status:** Approved (brainstorming) · **Repo:** `D:\Projects\reporeel` · Vercel · public `KP-MobileTechie/reporeel`

## Summary
RepoReel turns any git repository's history into a cinematic "code galaxy" movie rendered in the browser: files are stars, directories are clusters, commits are supernovas, contributors are comets. Users watch, scrub, and export the movie as a video to share. Flagship portfolio piece: a 2-4 week deep build whose centerpiece is a hand-written WebGL2 particle engine at 60fps with 10k+ stars, zero backend, zero running cost. Tagline: "Watch your codebase being born."

## Decisions (locked)
| Decision | Choice | Why |
|---|---|---|
| Concept | Repo-history galaxy movie with client-side video export | Viral shareable artifact; personalized output per repo |
| Visual language | Code Galaxy (not gource-tree, not code-city) | Most original look; fixes the uniqueness gap; best screenshots |
| Data source | Hybrid: local .git drag-drop + GitHub URL + pre-baked famous repos | Local mode kills rate limits and adds privacy-first hook; URL mode keeps instant gratification; demos give landing-page wow |
| Rendering | Raw WebGL2 engine, hand-written (no three.js) | Top-1% engineering proof: instancing, GLSL bloom, GPU trails |
| Cost | $0: static site, no backend, no analytics, no sign-up | Free tiers forever; HN-friendly privacy posture |
| Stack | Next.js 16 App Router (static) + TypeScript + Tailwind v4 + Vitest | Portfolio-consistent |
| Commits | Real dates from Jun 12 2026, author `krunal85 <kp587372@gmail.com>`, no AI attribution | Owner instruction |
| Audio | None in v1 | YAGNI; export simplicity |

## Galaxy metaphor (visual rules)
- **Files = stars.** Size grows with cumulative lines changed; brightness pulses on recent activity; color = file language (fixed palette).
- **Directories = star clusters.** Files orbit their directory's gravity well; nested directories form sub-clusters. Layout is force-simulated and seeded deterministically: the same repo always produces the same galaxy.
- **Commits = supernovas.** Each commit emits light ripples to its touched files; large commits add a subtle camera shake.
- **Contributors = comets** with glowing trails, traveling between the files they touch; a leaderboard shows top contributors of the current era.
- **Deletions** = stars collapse into brief black holes. **Renames/moves** = stars migrate between clusters.
- Bloom, glow, motion-blur trails via custom GLSL (framebuffer ping-pong post-process, additive blending).

## UX flow (single-page app, 3 states)
1. **Landing.** Full-screen live galaxy of a demo repo playing behind hero text. One input row: `[Drop a repo folder] [Paste GitHub URL] [▾ Famous repos]`. No sign-up, nothing leaves the browser in local mode (stated explicitly).
2. **Theater.** The movie view: WebGL canvas full-screen. Bottom bar: timeline scrubber with commit-density sparkline, play/pause, speed (1x to 100x), current date. Top-left: repo name, era stats (files, commits, contributors). Top-right: contributor leaderboard. Camera: cinematic auto-drift by default; free pan/zoom on user interaction; double-click to re-engage auto mode. 2-3 color themes. Keyboard: space (play/pause), arrows (scrub), +/- (speed).
3. **Export modal.** Duration (30/60/90 s), resolution (720p/1080p), theme. Renders client-side and downloads. Subtle `reporeel` watermark bottom-corner (attribution loop). "Copy share link" encodes `?repo=owner/name` for live replay by others (URL and demo modes only; local repos cannot be linked).

## Data ingestion
| Mode | How | Limits |
|---|---|---|
| Local folder (flagship) | Drag-drop or directory picker; parse `.git` in-browser with isomorphic-git inside a Web Worker | None; fully private; any git repo |
| GitHub URL | REST commits API, paginated; capped at ~3,000 most recent commits unauthenticated | 60 req/hr per visitor IP; inline "add a token for big repos" prompt; BYO token held in memory only, never stored or transmitted elsewhere |
| Famous repos | 5-6 pre-baked compressed JSON timelines (e.g. react, vscode, a linux subset) shipped as static assets | None; instant landing-page demo |

All modes normalize to one format:
```ts
interface CommitTimeline {
  repo: { name: string; source: "local" | "github" | "demo" };
  commits: {
    hash: string;
    author: string;       // display name, deduped
    date: number;         // epoch ms
    message: string;
    changes: { path: string; type: "add" | "modify" | "delete" | "rename"; delta: number; toPath?: string }[];
  }[];
}
```

## Architecture
```
app/page.tsx                landing + theater + export modal (one route, state machine)
app/layout.tsx              fonts, metadata, OG
lib/git/local.ts            isomorphic-git adapter (worker-hosted)          → CommitTimeline
lib/git/github.ts           GitHub REST adapter w/ pagination + token      → CommitTimeline
lib/git/demo.ts             static JSON loader                              → CommitTimeline
lib/timeline/build.ts       PURE: CommitTimeline → Timeline (star births/deaths, supernova + comet events, per-star growth)   (tested)
lib/timeline/scene.ts       PURE: sceneAtTime(timeline, t) → SceneState; interpolation between event frames                   (tested)
lib/layout/worker.ts        force simulation Web Worker: cluster gravity + collision; transferable Float32Arrays
lib/layout/sim.ts           PURE: simulation step functions, seeded PRNG (deterministic)                                       (tested)
engine/renderer.ts          WebGL2 context, render loop, resize, FPS guard
engine/stars.ts             instanced point-sprite stars (per-instance attribs: pos, size, color, pulse phase)
engine/effects.ts           supernova ripples, comet trails (GPU particles)
engine/post.ts              bloom: bright-pass + separable blur, ping-pong framebuffers, additive composite
engine/camera.ts            cinematic auto-drift + user pan/zoom with inertia
engine/shaders/*.glsl       vertex/fragment shaders
lib/export/recorder.ts      WebCodecs VideoEncoder + mp4-muxer; MediaRecorder WebM fallback
lib/colors.ts               PURE: language → color, theme palettes                                                            (tested)
components/                 LandingHero · InputRow · TimelineBar · StatsOverlay · Leaderboard · ExportModal · ThemePicker
tests/lib/*.test.ts         timeline, scene, sim determinism, adapters' normalization, colors (~40+ tests)
.github/workflows/ci.yml    test + build
```
- Next.js static export; the entire app runs client-side. No server code, no analytics, no cookies.
- Render loop receives layout positions from the worker and scene state from the pure timeline engine; the GL layer only draws.
- Performance budget: 60fps at 10k stars on a mid-range laptop; stars beyond 15k are aggregated into cluster-level meta-stars.

## Error handling / edge cases
- No WebGL2 → friendly "lite mode" notice; demo JSON still viewable as static render; no crash.
- Huge repos → cap at ~15k stars with aggregation; banner explains.
- GitHub rate limit hit mid-fetch → render the partial timeline, prompt for token to continue.
- Dropped folder isn't a git repo / empty repo / single commit → specific friendly empty states.
- WebCodecs unsupported → WebM via MediaRecorder; if both unavailable, show "record tab" guidance.
- Malformed git data (shallow clones, missing objects) → skip unparseable commits, surface a count.

## Testing (Vitest, ~40+ pure tests)
- `timeline/build`: births/deaths ordering, rename migration, delta accumulation, author dedup.
- `timeline/scene`: sceneAtTime correctness at boundaries, interpolation monotonicity, event windows.
- `layout/sim`: determinism (same seed → identical positions after N steps), cluster containment, no NaN under stress.
- `git/*`: fixture-based normalization for all three adapters (recorded GitHub JSON, synthetic isomorphic-git output, demo format).
- `colors`: language mapping totality, theme contrast floors.
- Rendering and export verified manually plus a perf harness page logging FPS; CI runs tests + static build.

## Configuration / setup
None for visitors. Owner setup: none beyond Vercel deploy. Optional later: register `reporeel.dev`.

## Out of scope (v2)
Audio/music in exports, GitLab/Bitbucket adapters, multi-repo galaxies, embeddable iframe widget, server-side render farm for repos too big for the browser, social leaderboard of rendered repos.

## Delivery
Public repo, Vercel static deploy, CI, MIT, README with engine writeup (instancing, bloom pipeline, worker layout, determinism) plus 3 exported demo videos and a Show HN draft. Commits real-dated Jun 12 2026 onward, krunal85, no AI attribution. README has no em dashes.
