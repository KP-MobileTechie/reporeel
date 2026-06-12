/// <reference lib="webworker" />
import git, { TREE } from "isomorphic-git";
import type { WalkerEntry } from "isomorphic-git";
import type { LocalLogEntry, ParseRequest, WorkerMessage } from "./local";
import { MAX_COMMITS } from "./github";

// ---------------------------------------------------------------------------
// Minimal in-memory fs satisfying isomorphic-git's PromiseFsClient interface,
// backed by a Map<string, Uint8Array> of the dropped `.git` directory. We do
// NOT pull in LightningFS (not installed). Usage is read-only: log + tree
// walks only read objects/refs, so all write methods throw EROFS.
//
// Paths are normalized to be absolute ("/.git/...") and forward-slashed.
// ---------------------------------------------------------------------------
class MemFs {
  private files = new Map<string, Uint8Array>();
  private dirs = new Set<string>();

  constructor(entries: { path: string; data: Uint8Array }[]) {
    this.dirs.add("/");
    for (const { path, data } of entries) {
      const p = norm(path);
      this.files.set(p, data);
      // register every ancestor directory
      let dir = parentOf(p);
      while (dir && !this.dirs.has(dir)) {
        this.dirs.add(dir);
        dir = parentOf(dir);
      }
    }
  }

  promises = {
    readFile: async (path: string, opts?: { encoding?: string } | string) => {
      const p = norm(path);
      const data = this.files.get(p);
      if (!data) throw enoent(p);
      const enc = typeof opts === "string" ? opts : opts?.encoding;
      if (enc === "utf8" || enc === "utf-8") return new TextDecoder().decode(data);
      return data;
    },
    readdir: async (path: string) => {
      const p = norm(path);
      if (!this.dirs.has(p)) throw enoent(p);
      const prefix = p === "/" ? "/" : p + "/";
      const names = new Set<string>();
      for (const key of this.files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const slash = rest.indexOf("/");
          names.add(slash === -1 ? rest : rest.slice(0, slash));
        }
      }
      for (const d of this.dirs) {
        if (d !== p && d.startsWith(prefix)) {
          const rest = d.slice(prefix.length);
          const slash = rest.indexOf("/");
          names.add(slash === -1 ? rest : rest.slice(0, slash));
        }
      }
      return [...names];
    },
    stat: async (path: string) => this._stat(path),
    lstat: async (path: string) => this._stat(path),
    // read-only filesystem: writes are not supported.
    writeFile: async () => {
      throw erofs();
    },
    unlink: async () => {
      throw erofs();
    },
    mkdir: async () => {
      throw erofs();
    },
    rmdir: async () => {
      throw erofs();
    },
    readlink: async (path: string) => {
      // No symlinks in a structured `.git` upload; treat as ENOENT.
      throw enoent(norm(path));
    },
    symlink: async () => {
      throw erofs();
    },
  };

  private _stat(path: string) {
    const p = norm(path);
    const isFile = this.files.has(p);
    const isDir = this.dirs.has(p);
    if (!isFile && !isDir) throw enoent(p);
    const size = isFile ? this.files.get(p)!.byteLength : 0;
    const mode = isDir ? 0o040000 : 0o100644;
    return {
      type: isDir ? "dir" : "file",
      mode,
      size,
      ino: 0,
      mtimeMs: 0,
      ctimeMs: 0,
      uid: 1,
      gid: 1,
      dev: 1,
      isFile: () => isFile,
      isDirectory: () => isDir,
      isSymbolicLink: () => false,
    };
  }
}

function norm(path: string): string {
  let p = path.replace(/\\/g, "/");
  if (!p.startsWith("/")) p = "/" + p;
  // collapse trailing slash (except root)
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function parentOf(path: string): string {
  if (path === "/") return "";
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "/" : path.slice(0, idx);
}

function enoent(path: string): Error & { code: string } {
  const e = new Error(`ENOENT: no such file or directory, ${path}`) as Error & { code: string };
  e.code = "ENOENT";
  return e;
}

function erofs(): Error & { code: string } {
  const e = new Error("EROFS: read-only file system") as Error & { code: string };
  e.code = "EROFS";
  return e;
}

// ---------------------------------------------------------------------------
// Diff two tree refs via git.walk. Produces FileChange-like entries:
//   - oid present in B only            → add
//   - oid present in A only            → delete
//   - oid differs between A and B      → modify
// delta is a churn proxy: abs(sizeB - sizeA) / 40 + 1 (we cannot cheaply diff
// line counts without decompressing+diffing blobs, so we approximate from blob
// byte-size difference — ~40 bytes per "line" of churn, +1 so every change
// registers at least 1 unit of mass). Rename detection is NOT attempted: a
// rename surfaces as delete(old)+add(new), which is acceptable for v1.
// ---------------------------------------------------------------------------
async function diffTrees(
  fs: MemFs,
  fromRef: string | null,
  toRef: string,
): Promise<LocalLogEntry["changes"]> {
  const trees = fromRef ? [TREE({ ref: fromRef }), TREE({ ref: toRef })] : [TREE({ ref: toRef })];

  const results: LocalLogEntry["changes"] = await git.walk({
    fs: fs as never,
    dir: "/",
    trees,
    map: async (filepath: string, entries: (WalkerEntry | null)[]) => {
      if (filepath === ".") return null;

      // Oldest commit (no parent): everything is an add.
      if (!fromRef) {
        const e = entries[0];
        if (!e) return null;
        if ((await e.type()) !== "blob") return null;
        const size = (await e.stat()).size;
        return { path: filepath, type: "add", delta: sizeToDelta(size) };
      }

      const [a, b] = entries;
      const aIsBlob = a ? (await a.type()) === "blob" : false;
      const bIsBlob = b ? (await b.type()) === "blob" : false;
      if (!aIsBlob && !bIsBlob) return null; // both trees or absent

      const aOid = aIsBlob ? await a!.oid() : null;
      const bOid = bIsBlob ? await b!.oid() : null;

      if (aOid === bOid) return null; // unchanged

      const aSize = aIsBlob ? (await a!.stat()).size : 0;
      const bSize = bIsBlob ? (await b!.stat()).size : 0;
      const delta = sizeToDelta(Math.abs(bSize - aSize));

      if (!aOid && bOid) return { path: filepath, type: "add", delta };
      if (aOid && !bOid) return { path: filepath, type: "delete", delta };
      return { path: filepath, type: "modify", delta };
    },
    reduce: async (parent: unknown, children: unknown[]) => {
      const flat: unknown[] = [];
      for (const c of children) {
        if (Array.isArray(c)) flat.push(...c);
        else if (c) flat.push(c);
      }
      if (parent) flat.push(parent);
      return flat;
    },
  });

  return results ?? [];
}

function sizeToDelta(byteDiff: number): number {
  return Math.floor(byteDiff / 40) + 1;
}

// ---------------------------------------------------------------------------
// Message handler.
// ---------------------------------------------------------------------------
async function handleParse(req: ParseRequest): Promise<void> {
  const fs = new MemFs(req.files);

  // not-a-repo guard: a real repo must have .git/HEAD.
  const hasHead = req.files.some((f) => {
    const p = norm(f.path);
    return p.endsWith("/.git/HEAD") || p === "/.git/HEAD";
  });
  if (!hasHead) {
    post({ type: "error", code: "not-a-repo", message: "no .git/HEAD found" });
    return;
  }

  let commits;
  try {
    commits = await git.log({ fs: fs as never, dir: "/", depth: MAX_COMMITS });
  } catch (e) {
    post({
      type: "error",
      code: "parse-failed",
      message: e instanceof Error ? e.message : "git log failed",
    });
    return;
  }

  // git.log returns newest-first. For each consecutive pair (newer, older) we
  // diff older→newer. The oldest commit (last in the list) is diffed against
  // null (all-add).
  const entries: LocalLogEntry[] = [];
  let skippedInWalk = 0;
  const total = commits.length;

  for (let i = 0; i < commits.length; i++) {
    const cur = commits[i];
    const parent = i + 1 < commits.length ? commits[i + 1] : null;
    try {
      const changes = await diffTrees(fs, parent ? parent.oid : null, cur.oid);
      entries.push({
        oid: cur.oid,
        author: cur.commit.author.name || "unknown",
        timestamp: cur.commit.author.timestamp, // seconds
        message: cur.commit.message,
        changes,
      });
    } catch {
      skippedInWalk++;
    }
    post({ type: "progress", done: i + 1, total });
  }

  post({ type: "done", entries, skippedInWalk });
}

function post(msg: WorkerMessage): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

self.onmessage = (ev: MessageEvent<ParseRequest>) => {
  if (ev.data?.type === "parse") {
    void handleParse(ev.data);
  }
};
