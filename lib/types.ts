export type Source = "local" | "github" | "demo";
export type ChangeType = "add" | "modify" | "delete" | "rename";

export interface FileChange { path: string; type: ChangeType; delta: number; toPath?: string }
export interface Commit { hash: string; author: string; date: number; message: string; changes: FileChange[] }
export interface CommitTimeline { repo: { name: string; source: Source }; commits: Commit[] } // commits sorted by date asc

export interface StarLife { id: number; path: string; lang: string; birth: number; death: number | null; sizeByTime: [number, number][] } // [t, cumulativeDelta]
export interface SupernovaEvent { t: number; starIds: number[]; magnitude: number; message: string; author: string }
export interface CometPath { author: string; hops: { t: number; starId: number }[] }
// dirs: unique directory list; starDirs[i] = index into dirs for star i (plain data, safe to postMessage)
export interface Timeline { stars: StarLife[]; supernovas: SupernovaEvent[]; comets: CometPath[]; t0: number; t1: number; dirs: string[]; starDirs: number[] }

export interface SceneState { t: number; aliveStarIds: number[]; sizes: Float32Array; pulses: Float32Array; activeSupernovas: { starIds: number[]; age: number; magnitude: number }[]; cometPositions: { author: string; fromStar: number; toStar: number; progress: number }[] }

export interface LayoutFrame { positions: Float32Array /* x,y per star id */; version: number }
