export type Source = "local" | "github" | "demo";
export type ChangeType = "add" | "modify" | "delete" | "rename"; // git "copy" status must be mapped to "rename" by adapters

// delta: churn magnitude; may be signed (negative = net shrink). Consumers must abs() before accumulating.
export interface FileChange { path: string; type: ChangeType; delta: number; toPath?: string }
export interface Commit { hash: string; author: string; date: number; message: string; changes: FileChange[] }
export interface CommitTimeline { repo: { name: string; owner?: string; source: Source }; commits: Commit[] } // owner set for github source (share links) // commits sorted by date asc

export interface StarLife { id: number; path: string; lang: string; birth: number; death: number | null; sizeByTime: [number, number][] } // sizeByTime: strictly increasing in t; value = cumulative abs(delta) after all changes at that t
export interface SupernovaEvent { t: number; starIds: number[]; magnitude: number; message: string; author: string }
export interface CometPath { author: string; hops: { t: number; starId: number }[] }
// dirs: unique directory list; starDirs[i] = index into dirs for star i (plain data, safe to postMessage)
// all t / t0 / t1 / birth / death values are epoch ms, same unit as Commit.date
export interface Timeline { stars: StarLife[]; supernovas: SupernovaEvent[]; comets: CometPath[]; t0: number; t1: number; dirs: string[]; starDirs: number[] }

// sizes/pulses are indexed by star.id (length = timeline.stars.length); stars not alive at t have sizes[id] = 0
export interface SceneState { t: number; aliveStarIds: number[]; sizes: Float32Array; pulses: Float32Array; activeSupernovas: { starIds: number[]; age: number; magnitude: number }[]; cometPositions: { author: string; fromStar: number; toStar: number; progress: number }[] }

export interface LayoutFrame { positions: Float32Array /* x,y per star id */; version: number }
