# RepoReel

[![CI](https://github.com/KP-MobileTechie/reporeel/actions/workflows/ci.yml/badge.svg)](https://github.com/KP-MobileTechie/reporeel/actions/workflows/ci.yml)

Turn any git repo's history into a cinematic "code galaxy" movie you can scrub and export as video, rendered entirely in your browser with a hand-written WebGL2 engine.

> Live demo: https://reporeel.vercel.app

<!-- demo gif: owner to record -->

Files are stars (colored by language, sized by churn), directories are gravity clusters, commits are supernovas, contributors are comets, and deletions collapse into black holes. Watch your codebase being born, then export the reel as an MP4.

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
npm test         # vitest run (211 tests)
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

## License

MIT, see [LICENSE](LICENSE).
