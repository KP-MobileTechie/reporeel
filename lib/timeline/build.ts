import type { CommitTimeline, StarLife, SupernovaEvent, CometPath, Timeline } from "@/lib/types";
import { langOf } from "@/lib/colors";

export const MAX_STARS = 15_000;

// ---------------------------------------------------------------------------
// dirOf: extract the directory component of a file path.
// "a/b/c.ts" → "a/b"   "index.ts" → ""
// ---------------------------------------------------------------------------
export function dirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

// ---------------------------------------------------------------------------
// buildTimeline: pure, deterministic, single-pass over commits.
// ---------------------------------------------------------------------------
export function buildTimeline(input: CommitTimeline): Timeline {
  const { commits } = input;

  if (commits.length === 0) {
    return { stars: [], supernovas: [], comets: [], t0: 0, t1: 0, dirs: [], starDirs: [] };
  }

  // -- working state ---------------------------------------------------------
  // stars array (mutable while building)
  const stars: StarLife[] = [];
  // Map from live file path → star id; entries removed on delete, re-added on re-add.
  const liveMap = new Map<string, number>();
  // Supernova and comet accumulators
  const supernovas: SupernovaEvent[] = [];
  const cometMap = new Map<string, { t: number; starId: number }[]>(); // author → hops

  // dirs registry
  const dirs: string[] = [];
  const dirIndex = new Map<string, number>();
  const starDirs: number[] = []; // indexed by star id

  function getOrAddDir(dir: string): number {
    let idx = dirIndex.get(dir);
    if (idx === undefined) {
      idx = dirs.length;
      dirs.push(dir);
      dirIndex.set(dir, idx);
    }
    return idx;
  }

  function getOrCreateStar(path: string, date: number): number {
    const existing = liveMap.get(path);
    if (existing !== undefined) return existing;
    // birth a new star
    const id = stars.length;
    const dir = dirOf(path);
    const dirIdx = getOrAddDir(dir);
    stars.push({ id, path, lang: langOf(path), birth: date, death: null, sizeByTime: [] });
    starDirs.push(dirIdx);
    liveMap.set(path, id);
    return id;
  }

  // -- single pass over commits ----------------------------------------------
  const t0 = commits[0].date;
  const t1 = commits[commits.length - 1].date;

  for (const commit of commits) {
    const { date, author, message, changes } = commit;
    let totalAbsDelta = 0;
    const touchedIds: number[] = []; // in change order (before dedup)
    const seenInCommit = new Set<number>();

    for (const change of changes) {
      const { path, type, delta, toPath } = change;
      totalAbsDelta += Math.abs(delta);

      if (type === "delete") {
        // Find the live star, set death, remove from live map.
        const id = liveMap.get(path);
        if (id !== undefined) {
          stars[id].death = date;
          liveMap.delete(path);
          if (!seenInCommit.has(id)) { touchedIds.push(id); seenInCommit.add(id); }
        }
        // No sizeByTime entry for deletes (delta is 0 and file is gone).
        continue;
      }

      if (type === "rename" && toPath !== undefined) {
        const id = liveMap.get(path);
        if (id !== undefined) {
          // Update the star in-place: new path, new lang, new dir.
          stars[id].path = toPath;
          stars[id].lang = langOf(toPath);
          const newDir = dirOf(toPath);
          starDirs[id] = getOrAddDir(newDir);
          liveMap.delete(path);
          liveMap.set(toPath, id);
          if (!seenInCommit.has(id)) { touchedIds.push(id); seenInCommit.add(id); }
        } else {
          // Rename of a file we haven't seen — treat as add of toPath.
          const newId = getOrCreateStar(toPath, date);
          if (!seenInCommit.has(newId)) { touchedIds.push(newId); seenInCommit.add(newId); }
        }
        // Renames typically have delta=0; we still accumulate if nonzero.
        if (delta !== 0) {
          const renameId = liveMap.get(toPath)!;
          const prev = stars[renameId].sizeByTime;
          const prevCum = prev.length > 0 ? prev[prev.length - 1][1] : 0;
          const newCum = prevCum + Math.abs(delta);
          if (prev.length > 0 && prev[prev.length - 1][0] === date) {
            prev[prev.length - 1][1] = newCum;
          } else {
            prev.push([date, newCum]);
          }
        }
        continue;
      }

      // "add" or "modify"
      const id = getOrCreateStar(path, date);
      const prev = stars[id].sizeByTime;
      const prevCum = prev.length > 0 ? prev[prev.length - 1][1] : 0;
      const newCum = prevCum + Math.abs(delta);
      if (prev.length > 0 && prev[prev.length - 1][0] === date) {
        prev[prev.length - 1][1] = newCum;
      } else {
        prev.push([date, newCum]);
      }
      if (!seenInCommit.has(id)) { touchedIds.push(id); seenInCommit.add(id); }
    }

    // Supernova: one per commit.
    const magnitude = Math.min(1, Math.log10(1 + totalAbsDelta) / 4);
    supernovas.push({ t: date, starIds: touchedIds, magnitude, message, author });

    // Comet: record first touched star per commit per author.
    if (touchedIds.length > 0) {
      const firstId = touchedIds[0];
      let hops = cometMap.get(author);
      if (!hops) { hops = []; cometMap.set(author, hops); }
      hops.push({ t: date, starId: firstId });
    }
  }

  const comets: CometPath[] = [];
  for (const [author, hops] of cometMap) {
    comets.push({ author, hops });
  }

  // -- aggregation -----------------------------------------------------------
  // If stars.length > MAX_STARS: per-directory, gather the smallest-mass stars
  // and merge them into one meta-star per directory. Re-index all ids densely.
  if (stars.length > MAX_STARS) {
    aggregate(stars, starDirs, dirs, supernovas, comets);
  }

  return { stars, supernovas, comets, t0, t1, dirs, starDirs };
}

// ---------------------------------------------------------------------------
// aggregate: collapse smallest-mass stars per dir until total <= MAX_STARS.
// Mutates all passed arrays in place and re-indexes ids 0..n-1.
// ---------------------------------------------------------------------------
function aggregate(
  stars: StarLife[],
  starDirs: number[],
  dirs: string[],
  supernovas: SupernovaEvent[],
  comets: CometPath[],
): void {
  // Helper: final cumulative mass of a star.
  function finalMass(s: StarLife): number {
    const sb = s.sizeByTime;
    return sb.length > 0 ? sb[sb.length - 1][1] : 0;
  }

  // Group star ids by directory index.
  const dirGroups = new Map<number, number[]>(); // dirIdx → [starId, ...]
  for (const star of stars) {
    const dIdx = starDirs[star.id];
    let g = dirGroups.get(dIdx);
    if (!g) { g = []; dirGroups.set(dIdx, g); }
    g.push(star.id);
  }

  const excess = stars.length - MAX_STARS;
  // We need to eliminate at least `excess` stars. Each dir with >= 2 stars can
  // contribute by merging its N-1 smallest into one meta-star (net removal = N-1).
  // We greedily merge dirs sorted by total star count descending.
  const dirsBySize = [...dirGroups.entries()].sort((a, b) => b[1].length - a[1].length);

  let eliminated = 0;
  // Map: old star id → new star id (filled during re-index).
  // We'll build a "remove set" of ids to merge and track the meta-star per dir.
  const metaStarForDir = new Map<number, number>(); // dirIdx → meta-star id (old id of the meta-star placeholder)
  const mergeGroups: { dirIdx: number; ids: number[] }[] = []; // ids to merge per dir
  // metaRemap: removed old id → meta-star's old id (for O(1) remapId lookup)
  const metaRemap = new Map<number, number>();

  for (const [dirIdx, ids] of dirsBySize) {
    if (eliminated >= excess) break;
    if (ids.length < 2) continue;

    // Sort ascending by mass; merge all but keep up to 1 survivor if needed.
    ids.sort((a, b) => finalMass(stars[a]) - finalMass(stars[b]));

    // How many can we merge here? We must keep at least 1 star in the dir.
    // Merging n stars into 1 eliminates n-1. Merge as many as needed.
    const toMerge = Math.min(ids.length, excess - eliminated + 1);
    // toMerge is how many go into the meta. We eliminate toMerge-1 of them.
    if (toMerge < 2) continue;

    const mergeIds = ids.slice(0, toMerge);
    mergeGroups.push({ dirIdx, ids: mergeIds });
    eliminated += toMerge - 1;

    // Populate metaRemap: removed ids (indices 1..toMerge-1) → metaId (ids[0])
    const metaId = mergeIds[0];
    for (let i = 1; i < mergeIds.length; i++) {
      metaRemap.set(mergeIds[i], metaId);
    }
  }

  if (mergeGroups.length === 0) return;

  // Build a set of ids to remove from the stars array.
  const removeIds = new Set<number>();
  // Also build: dirIdx → meta-star data we'll insert.
  const metaData = new Map<number, { birth: number; death: number | null; sizeByTime: [number, number][] }>();

  for (const { dirIdx, ids } of mergeGroups) {
    // The meta-star takes over the first (smallest) id slot.
    const metaId = ids[0]; // will be repurposed; we keep it alive
    metaStarForDir.set(dirIdx, metaId);
    for (let i = 1; i < ids.length; i++) removeIds.add(ids[i]);

    // Merge: combine all sizeByTime into time-sorted cumulative series.
    const allEvents: [number, number][] = []; // [t, absDelta]
    let minBirth = stars[ids[0]].birth;
    let maxDeath: number | null = null;
    let someAlive = false;

    for (const sid of ids) {
      const s = stars[sid];
      if (s.birth < minBirth) minBirth = s.birth;
      if (s.death === null) { someAlive = true; }
      else if (maxDeath === null || s.death > maxDeath) { maxDeath = s.death; }

      // Reconstruct per-event deltas from cumulative.
      let prev = 0;
      for (const [t, cum] of s.sizeByTime) {
        allEvents.push([t, cum - prev]);
        prev = cum;
      }
    }

    // Sort events by time and build new cumulative series.
    allEvents.sort((a, b) => a[0] - b[0]);
    let cum = 0;
    const merged: [number, number][] = [];
    for (const [t, delta] of allEvents) {
      cum += delta;
      // Collapse same-time entries.
      if (merged.length > 0 && merged[merged.length - 1][0] === t) {
        merged[merged.length - 1][1] = cum;
      } else {
        merged.push([t, cum]);
      }
    }

    metaData.set(metaId, {
      birth: minBirth,
      death: someAlive ? null : maxDeath,
      sizeByTime: merged,
    });
  }

  // Repurpose the meta-star slots in the stars array.
  for (const [dirIdx, metaId] of metaStarForDir) {
    const data = metaData.get(metaId)!;
    const dirStr = dirs[dirIdx];
    const mergedCount = mergeGroups.find((g) => g.dirIdx === dirIdx)!.ids.length;
    stars[metaId].path = `${dirStr}/+${mergedCount} files`;
    stars[metaId].lang = "other";
    stars[metaId].birth = data.birth;
    stars[metaId].death = data.death;
    stars[metaId].sizeByTime = data.sizeByTime;
  }

  // --- Re-index: remove absorbed stars, compact the array, remap all ids. ---
  // new id for each old id; -1 = removed.
  const originalLen = stars.length;
  const idRemap = new Int32Array(originalLen).fill(-1);
  let newId = 0;
  // Iterate in original order to preserve stable ordering.
  for (let oldId = 0; oldId < originalLen; oldId++) {
    if (!removeIds.has(oldId)) {
      idRemap[oldId] = newId++;
    }
  }

  // Linear compaction: single forward pass, no splice.
  let writeIdx = 0;
  for (let oldId = 0; oldId < originalLen; oldId++) {
    if (!removeIds.has(oldId)) {
      stars[writeIdx] = stars[oldId];
      stars[writeIdx].id = writeIdx;
      writeIdx++;
    }
  }
  stars.length = writeIdx;

  // Compact starDirs with same linear pass.
  let writeDirIdx = 0;
  for (let oldId = 0; oldId < originalLen; oldId++) {
    if (!removeIds.has(oldId)) {
      starDirs[writeDirIdx++] = starDirs[oldId];
    }
  }
  starDirs.length = writeDirIdx;

  // Remap supernovas: removed ids are routed to their dir's meta-star via remapId.
  for (const sn of supernovas) {
    const remapped: number[] = [];
    const seen = new Set<number>();
    for (const oldId of sn.starIds) {
      const newMappedId = remapId(oldId, removeIds, metaRemap, idRemap);
      if (newMappedId !== -1 && !seen.has(newMappedId)) {
        remapped.push(newMappedId);
        seen.add(newMappedId);
      }
    }
    sn.starIds = remapped;
  }

  // Remap comets.
  for (const comet of comets) {
    for (const hop of comet.hops) {
      hop.starId = remapId(hop.starId, removeIds, metaRemap, idRemap);
    }
  }
}

// Helper: map an old star id to its new id, routing removed ids to their meta-star.
function remapId(
  oldId: number,
  removeIds: Set<number>,
  metaRemap: Map<number, number>,
  idRemap: Int32Array,
): number {
  if (!removeIds.has(oldId)) {
    return idRemap[oldId];
  }
  // O(1) lookup: removed id → its meta-star's old id.
  const metaOldId = metaRemap.get(oldId);
  if (metaOldId === undefined) {
    // No merge group found — this is an invariant violation.
    throw new Error("buildTimeline: unmapped star id after aggregation");
  }
  return idRemap[metaOldId];
}
