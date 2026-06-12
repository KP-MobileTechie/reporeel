// @vitest-environment node
//
// Regression test for the git.walk recursion-pruning bug. isomorphic-git's
// git.walk ONLY descends into a directory when `map` returns a non-null value
// (node_modules/isomorphic-git/index.js: `if (parent !== null) { ...iterate
// children... }`). The original diffTrees returned `null` for the root "." and
// for directory entries, so the walk never descended and EVERY local diff came
// back empty. walkDiff.ts now returns `undefined` for those cases. The core of
// this test is commit 2, which adds a NESTED file `src/b.ts`: if recursion is
// broken, that change disappears from the diff.
import { describe, it, expect } from "vitest";
import git from "isomorphic-git";
import { diffTrees } from "@/lib/git/walkDiff";

// ---------------------------------------------------------------------------
// A minimal WRITABLE Map-backed fs satisfying the subset of isomorphic-git's
// PromiseFsClient that git.init / git.add / git.commit / git.log / git.walk
// exercise. MemFs in walkDiff.ts is read-only by design; this writable variant
// implements readFile/writeFile/unlink/readdir/mkdir/rmdir/stat/lstat. Missing
// paths throw an error whose `.code === "ENOENT"`, which is what isomorphic-git
// branches on. diffTrees only READS, so we can pass this same fs straight to it.
// ---------------------------------------------------------------------------
function makeFs() {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(["/"]);

  const norm = (p: string) => {
    let s = p.replace(/\\/g, "/");
    if (!s.startsWith("/")) s = "/" + s;
    if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
    return s;
  };
  const parentOf = (p: string) => {
    if (p === "/") return "";
    const i = p.lastIndexOf("/");
    return i <= 0 ? "/" : p.slice(0, i);
  };
  const enoent = (p: string) => {
    const e = new Error(`ENOENT: no such file or directory, ${p}`) as Error & { code: string };
    e.code = "ENOENT";
    return e;
  };
  const ensureAncestors = (p: string) => {
    let d = parentOf(p);
    while (d && !dirs.has(d)) {
      dirs.add(d);
      d = parentOf(d);
    }
  };
  const statOf = (path: string) => {
    const p = norm(path);
    const isFile = files.has(p);
    const isDir = dirs.has(p);
    if (!isFile && !isDir) throw enoent(p);
    const size = isFile ? files.get(p)!.byteLength : 0;
    return {
      type: isDir ? "dir" : "file",
      mode: isDir ? 0o040000 : 0o100644,
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
  };

  return {
    promises: {
      readFile: async (path: string, opts?: { encoding?: string } | string) => {
        const p = norm(path);
        const data = files.get(p);
        if (!data) throw enoent(p);
        const enc = typeof opts === "string" ? opts : opts?.encoding;
        if (enc === "utf8" || enc === "utf-8") return new TextDecoder().decode(data);
        return data;
      },
      writeFile: async (path: string, data: Uint8Array | string) => {
        const p = norm(path);
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
        files.set(p, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
        ensureAncestors(p);
      },
      unlink: async (path: string) => {
        const p = norm(path);
        if (!files.has(p)) throw enoent(p);
        files.delete(p);
      },
      readdir: async (path: string) => {
        const p = norm(path);
        if (!dirs.has(p)) throw enoent(p);
        const prefix = p === "/" ? "/" : p + "/";
        const names = new Set<string>();
        const collect = (key: string) => {
          if (key === p || !key.startsWith(prefix)) return;
          const rest = key.slice(prefix.length);
          const slash = rest.indexOf("/");
          names.add(slash === -1 ? rest : rest.slice(0, slash));
        };
        for (const k of files.keys()) collect(k);
        for (const d of dirs) collect(d);
        return [...names];
      },
      mkdir: async (path: string) => {
        const p = norm(path);
        dirs.add(p);
        ensureAncestors(p);
      },
      rmdir: async (path: string) => {
        const p = norm(path);
        dirs.delete(p);
      },
      stat: async (path: string) => statOf(path),
      lstat: async (path: string) => statOf(path),
      // isomorphic-git's bindFs unconditionally `.bind()`s these, so they must
      // exist even though a plain `.git` repo has no symlinks.
      readlink: async (path: string) => {
        throw enoent(norm(path));
      },
      symlink: async () => {
        const e = new Error("EROFS: symlinks unsupported") as Error & { code: string };
        e.code = "EROFS";
        throw e;
      },
    },
  };
}

// Fixed author so commits are deterministic (oids stay reproducible).
const author = { name: "Test", email: "test@example.com" };

async function buildRepo() {
  const fs = makeFs();
  const dir = "/";
  await git.init({ fs: fs as never, dir });

  // commit 1: add a.ts
  await fs.promises.writeFile("/a.ts", "export const a = 1;\n");
  await git.add({ fs: fs as never, dir, filepath: "a.ts" });
  await git.commit({
    fs: fs as never,
    dir,
    message: "c1: add a.ts",
    author: { ...author, timestamp: 1000, timezoneOffset: 0 },
  });

  // commit 2: modify a.ts AND add src/b.ts (NESTED — the regression core)
  await fs.promises.writeFile("/a.ts", "export const a = 2;\nexport const aa = 3;\n");
  await fs.promises.writeFile("/src/b.ts", "export const b = 10;\n");
  await git.add({ fs: fs as never, dir, filepath: "a.ts" });
  await git.add({ fs: fs as never, dir, filepath: "src/b.ts" });
  await git.commit({
    fs: fs as never,
    dir,
    message: "c2: modify a.ts + add src/b.ts",
    author: { ...author, timestamp: 2000, timezoneOffset: 0 },
  });

  // commit 3: delete src/b.ts
  await git.remove({ fs: fs as never, dir, filepath: "src/b.ts" });
  await fs.promises.unlink("/src/b.ts");
  await git.commit({
    fs: fs as never,
    dir,
    message: "c3: delete src/b.ts",
    author: { ...author, timestamp: 3000, timezoneOffset: 0 },
  });

  return fs;
}

// Order-insensitive comparison of {path,type} ignoring delta.
function shapes(changes: { path: string; type: string; delta: number }[]) {
  return [...changes]
    .map((c) => ({ path: c.path, type: c.type }))
    .sort((x, y) => (x.path + x.type).localeCompare(y.path + y.type));
}

describe("walkDiff.diffTrees recursion", () => {
  it("diffs each commit including the nested src/ file", async () => {
    const fs = await buildRepo();

    // git.log is newest-first; reverse to oldest-first c1,c2,c3.
    const log = await git.log({ fs: fs as never, dir: "/" });
    const oids = log.map((l) => l.oid).reverse();
    expect(oids.length).toBe(3);
    const [c1, c2, c3] = oids;

    // commit 1: oldest, no parent → everything is an add. Only a.ts.
    const d1 = await diffTrees(fs as never, null, c1);
    expect(shapes(d1)).toEqual([{ path: "a.ts", type: "add" }]);

    // commit 2: modify a.ts + add NESTED src/b.ts. If recursion were broken
    // (map returning null for the src/ tree entry), src/b.ts would be absent.
    const d2 = await diffTrees(fs as never, c1, c2);
    expect(shapes(d2)).toEqual(
      shapes([
        { path: "a.ts", type: "modify", delta: 1 },
        { path: "src/b.ts", type: "add", delta: 1 },
      ]),
    );

    // commit 3: delete the nested src/b.ts.
    const d3 = await diffTrees(fs as never, c2, c3);
    expect(shapes(d3)).toEqual([{ path: "src/b.ts", type: "delete" }]);

    // every emitted change carries at least 1 unit of delta mass.
    for (const d of [d1, d2, d3]) {
      for (const c of d) expect(c.delta).toBeGreaterThanOrEqual(1);
    }
  });
});
