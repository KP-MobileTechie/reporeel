import git, { TREE } from "isomorphic-git";
import type { WalkerEntry } from "isomorphic-git";
import type { LocalLogEntry } from "./local";

// ---------------------------------------------------------------------------
// Minimal in-memory fs satisfying isomorphic-git's PromiseFsClient interface,
// backed by a Map<string, Uint8Array> of the dropped `.git` directory. We do
// NOT pull in LightningFS (not installed). Usage is read-only: log + tree
// walks only read objects/refs, so all write methods throw EROFS.
//
// Paths are normalized to be absolute ("/.git/...") and forward-slashed.
// ---------------------------------------------------------------------------
export class MemFs {
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

export function erofs(): Error & { code: string } {
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
//
// RECURSION GATE — CRITICAL: isomorphic-git's git.walk ONLY descends into a
// directory when `map` returns a NON-NULL value (see node_modules/
// isomorphic-git/index.js: `const parent = await map(...); if (parent !== null)
// { ...iterate(walk, children)... }`). If `map` returns null for a directory
// entry, the walk never visits that directory's children and the diff comes
// back EMPTY for everything nested below it (e.g. anything under src/). We
// therefore return `undefined` — NOT `null` — for every entry we don't want to
// emit a change for (the root ".", tree/dir entries, and unchanged blobs).
// `undefined` lets the walk recurse; the gathered children are then filtered
// (`walkedChildren.filter(x => x !== undefined)`) so undefined leaves are
// harmlessly dropped, and our reduce additionally skips non-array / falsy
// parents. Returning null anywhere a directory could appear silently breaks
// nested diffs — this was the root cause of the empty-local-diff bug.
//
// NOTE: GitWalkerRepo.stat() is a stub (returns undefined) in isomorphic-git
// v1.x — see node_modules/isomorphic-git/index.js `async stat(_entry) {}`.
// We therefore obtain blob byte-size via entry.content()?.byteLength instead.
// content() is only called for blob entries whose oids actually differ, so
// the cost is bounded to truly changed files.
// ---------------------------------------------------------------------------
export async function diffTrees(
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
      // Root sentinel: must recurse, so return undefined (not null).
      if (filepath === ".") return undefined;

      // Oldest commit (no parent): everything is an add.
      if (!fromRef) {
        const e = entries[0];
        // Dir / absent entries must recurse → undefined, not null.
        if (!e) return undefined;
        if ((await e.type()) !== "blob") return undefined;
        const size = (await e.content())?.byteLength ?? 0;
        return { path: filepath, type: "add", delta: sizeToDelta(size) };
      }

      const [a, b] = entries;
      const aIsBlob = a ? (await a.type()) === "blob" : false;
      const bIsBlob = b ? (await b.type()) === "blob" : false;
      // Both trees or absent: this is a directory — recurse via undefined.
      if (!aIsBlob && !bIsBlob) return undefined;

      const aOid = aIsBlob ? await a!.oid() : null;
      const bOid = bIsBlob ? await b!.oid() : null;

      // Unchanged blob: leaf node, emit nothing. undefined (consistent with
      // the dir case and filtered identically by the walk) is used here too.
      if (aOid === bOid) return undefined;

      const aSize = aIsBlob ? ((await a!.content())?.byteLength ?? 0) : 0;
      const bSize = bIsBlob ? ((await b!.content())?.byteLength ?? 0) : 0;
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

export function sizeToDelta(byteDiff: number): number {
  return Math.floor(byteDiff / 40) + 1;
}
