"use client";

import { useRef, useState } from "react";

export interface DemoEntry {
  id: string;
  label: string;
  file: string;
}

export interface LocalFiles {
  repoName: string;
  files: { path: string; data: Uint8Array }[];
}

/**
 * Parse a GitHub repo reference. Accepts:
 *   https://github.com/owner/repo[.git][/...]
 *   github.com/owner/repo
 *   owner/repo
 * Returns null for anything that does not resolve to owner/repo.
 */
export function parseGithubRef(input: string): { owner: string; repo: string } | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
  // Strip any trailing path / query / .git
  s = s.split(/[?#]/)[0];
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  let repo = parts[1].replace(/\.git$/, "");
  if (!owner || !repo) return null;
  // Basic charset guard.
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  return { owner, repo };
}

// ---------------------------------------------------------------------------
// Directory collection: gather `.git/**` files as { path, data } pairs with
// paths RELATIVE and forward-slashed, beginning at ".git/..." (MemFs.norm makes
// them absolute "/.git/..."; localWorker mounts at dir:"/"). We skip .git/hooks
// and .git/logs (not needed for log/tree walks); everything else under .git —
// including objects/pack — is required for packed repos.
// ---------------------------------------------------------------------------
function shouldSkip(relPath: string): boolean {
  return /(^|\/)\.git\/(hooks|logs)\//.test(relPath);
}

function normalizeGitPath(rel: string): string | null {
  const p = rel.replace(/\\/g, "/");
  const idx = p.indexOf(".git/");
  if (idx === -1 && !p.endsWith(".git")) return null;
  // Keep from ".git/..." onward so the worker mounts at /.git.
  const at = p.indexOf(".git/");
  return at === -1 ? null : p.slice(at);
}

async function collectFromDataTransferItem(
  entry: FileSystemEntry,
  out: { path: string; data: Uint8Array }[],
): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((res, rej) => fileEntry.file(res, rej));
    const rel = entry.fullPath.replace(/^\//, "");
    const gp = normalizeGitPath(rel);
    if (gp && !shouldSkip(gp)) {
      const buf = await file.arrayBuffer();
      out.push({ path: gp, data: new Uint8Array(buf) });
    }
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    // readEntries returns in batches; loop until empty.
    let batch: FileSystemEntry[];
    do {
      batch = await new Promise<FileSystemEntry[]>((res, rej) =>
        reader.readEntries(res, rej),
      );
      for (const child of batch) await collectFromDataTransferItem(child, out);
    } while (batch.length > 0);
  }
}

/** Collect via the File System Access API directory handle (preferred path). */
async function collectFromHandle(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: { path: string; data: Uint8Array }[],
): Promise<void> {
  const dirEntries = (dir as unknown as {
    entries(): AsyncIterable<[string, FileSystemHandle]>;
  }).entries();
  for await (const [name, handle] of dirEntries) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      const gp = normalizeGitPath(rel);
      if (gp && !shouldSkip(gp)) {
        const file = await (handle as FileSystemFileHandle).getFile();
        const buf = await file.arrayBuffer();
        out.push({ path: gp, data: new Uint8Array(buf) });
      }
    } else {
      await collectFromHandle(handle as FileSystemDirectoryHandle, rel, out);
    }
  }
}

export interface InputRowProps {
  demos: DemoEntry[];
  busy?: boolean;
  rateLimit?: { commitsLoaded: number } | null;
  onLocal: (files: LocalFiles) => void;
  onGithub: (owner: string, repo: string, token?: string) => void;
  onDemo: (id: string) => void;
  onContinuePartial?: () => void;
}

export function InputRow({
  demos,
  busy,
  rateLimit,
  onLocal,
  onGithub,
  onDemo,
  onContinuePartial,
}: InputRowProps) {
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [token, setToken] = useState("");
  const dirInputRef = useRef<HTMLInputElement>(null);

  const submitGithub = (tok?: string) => {
    const parsed = parseGithubRef(url);
    if (!parsed) {
      setUrlError("Enter owner/repo or a github.com URL");
      return;
    }
    setUrlError(null);
    onGithub(parsed.owner, parsed.repo, tok);
  };

  // ── Directory pick via File System Access API (preferred) ──────────────
  const pickDirectory = async () => {
    const picker = (window as unknown as {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;
    if (picker) {
      try {
        const handle = await picker();
        const out: { path: string; data: Uint8Array }[] = [];
        await collectFromHandle(handle, handle.name, out);
        if (out.length === 0) {
          setUrlError("No .git directory found in that folder.");
          return;
        }
        onLocal({ repoName: handle.name, files: out });
      } catch (e) {
        // User cancelled the picker — ignore. AbortError has name "AbortError".
        if ((e as Error)?.name !== "AbortError") {
          setUrlError("Could not read that folder.");
        }
      }
      return;
    }
    // Fallback: webkitdirectory input.
    dirInputRef.current?.click();
  };

  const onDirInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const out: { path: string; data: Uint8Array }[] = [];
    let repoName = "repository";
    for (const f of Array.from(fileList)) {
      // webkitRelativePath: "repoName/.git/HEAD"
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const top = rel.split("/")[0];
      if (top) repoName = top;
      const gp = normalizeGitPath(rel);
      if (gp && !shouldSkip(gp)) {
        const buf = await f.arrayBuffer();
        out.push({ path: gp, data: new Uint8Array(buf) });
      }
    }
    if (out.length === 0) {
      setUrlError("That folder has no .git directory.");
      return;
    }
    onLocal({ repoName, files: out });
  };

  // ── Drag & drop ────────────────────────────────────────────────────────
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const items = Array.from(e.dataTransfer.items);
    const out: { path: string; data: Uint8Array }[] = [];
    let repoName = "repository";
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        if (entry.isDirectory) repoName = entry.name;
        await collectFromDataTransferItem(entry, out);
      }
    }
    if (out.length === 0) {
      setUrlError("Drop a folder that contains a .git directory.");
      return;
    }
    onLocal({ repoName, files: out });
  };

  return (
    <div className="w-full max-w-2xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        {/* (1) Drop zone / directory picker */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed px-4 py-5 text-center transition ${
            dragOver ? "border-accent bg-accent/10" : "border-border bg-surface/60"
          }`}
        >
          <button
            type="button"
            onClick={pickDirectory}
            disabled={busy}
            className="text-sm font-medium text-fg hover:text-accent disabled:opacity-40"
          >
            Drop a repo folder or click to choose
          </button>
          <span className="mt-1 text-[11px] text-fg-dim">
            code never leaves your browser
          </span>
          <input
            ref={dirInputRef}
            type="file"
            // @ts-expect-error - non-standard but widely supported directory attrs.
            webkitdirectory=""
            directory=""
            multiple
            hidden
            onChange={onDirInput}
          />
        </div>

        {/* (2) GitHub URL */}
        <div className="flex flex-1 flex-col gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitGithub();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="github.com/owner/repo"
              aria-label="GitHub repository URL"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-dim disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={busy}
              className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40"
            >
              Watch
            </button>
          </form>

          {/* (3) Demo dropdown */}
          <select
            defaultValue=""
            disabled={busy}
            aria-label="Load a demo repository"
            onChange={(e) => {
              if (e.target.value) onDemo(e.target.value);
            }}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg disabled:opacity-40"
          >
            <option value="" disabled>
              or try a demo…
            </option>
            {demos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {urlError && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {urlError}
        </p>
      )}

      {/* Rate-limit recovery panel */}
      {rateLimit && (
        <div className="mt-3 rounded-xl border border-border bg-surface/80 p-4 text-sm">
          <p className="text-fg">
            GitHub rate limit hit. {rateLimit.commitsLoaded.toLocaleString()} commits loaded.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onContinuePartial}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:brightness-110"
            >
              Continue with partial
            </button>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="GitHub token"
              aria-label="GitHub personal access token"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-fg placeholder:text-fg-dim"
            />
            <button
              type="button"
              onClick={() => submitGithub(token || undefined)}
              disabled={!token}
              className="rounded-lg border border-border px-3 py-2 text-sm text-fg hover:border-accent disabled:opacity-40"
            >
              Retry with token
            </button>
          </div>
          <p className="mt-2 text-[11px] text-fg-dim">
            kept in memory only, never stored
          </p>
        </div>
      )}
    </div>
  );
}
