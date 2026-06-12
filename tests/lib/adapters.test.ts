import { describe, it, expect } from "vitest";
import { loadDemo } from "@/lib/git/demo";
import {
  normalizeGithub,
  MAX_COMMITS,
  type GithubCommitListItem,
  type GithubCommitDetail,
} from "@/lib/git/github";
import { normalizeLocal, type LocalLogEntry } from "@/lib/git/local";
import { AdapterError, RateLimitError } from "@/lib/git/errors";
import type { CommitTimeline } from "@/lib/types";

import demoFixture from "@/tests/fixtures/demo-timeline.json";
import githubPage from "@/tests/fixtures/github-commits-page.json";
import githubDetail from "@/tests/fixtures/github-commit-detail.json";

// ===========================================================================
// errors
// ===========================================================================
describe("errors", () => {
  it("AdapterError carries message and name", () => {
    const e = new AdapterError("boom");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("boom");
    expect(e.name).toBe("AdapterError");
  });

  it("RateLimitError carries the partial timeline", () => {
    const partial: CommitTimeline = { repo: { name: "r", source: "github" }, commits: [] };
    const e = new RateLimitError(partial);
    expect(e).toBeInstanceOf(Error);
    expect(e.partial).toBe(partial);
  });
});

// ===========================================================================
// loadDemo
// ===========================================================================
describe("loadDemo", () => {
  it("loads the valid fixture", () => {
    const tl = loadDemo(demoFixture);
    expect(tl.repo).toEqual({ name: "demo-repo", source: "demo" });
    expect(tl.commits).toHaveLength(3);
  });

  it("sorts commits by date ascending (fixture is intentionally unsorted)", () => {
    const tl = loadDemo(demoFixture);
    const dates = tl.commits.map((c) => c.date);
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
    expect(tl.commits[0].message).toBe("Initial commit");
    expect(tl.commits[2].message).toBe("Rename module");
  });

  it("preserves toPath on rename changes", () => {
    const tl = loadDemo(demoFixture);
    const renameCommit = tl.commits[2];
    const rename = renameCommit.changes.find((c) => c.type === "rename");
    expect(rename?.toPath).toBe("src/core.ts");
  });

  it("throws when repo is missing", () => {
    expect(() => loadDemo({ commits: [] })).toThrow(AdapterError);
    expect(() => loadDemo({ commits: [] })).toThrow("invalid demo timeline");
  });

  it("throws when source is not 'demo'", () => {
    expect(() => loadDemo({ repo: { name: "x", source: "github" }, commits: [] })).toThrow(
      AdapterError,
    );
  });

  it("throws when a commit is missing date", () => {
    const bad = {
      repo: { name: "x", source: "demo" },
      commits: [{ hash: "h", author: "a", message: "m", changes: [] }],
    };
    expect(() => loadDemo(bad)).toThrow(AdapterError);
  });

  it("throws when a commit date is not a number", () => {
    const bad = {
      repo: { name: "x", source: "demo" },
      commits: [{ hash: "h", author: "a", date: "2023", message: "m", changes: [] }],
    };
    expect(() => loadDemo(bad)).toThrow(AdapterError);
  });

  it("throws on a change with a bogus type", () => {
    const bad = {
      repo: { name: "x", source: "demo" },
      commits: [
        {
          hash: "h",
          author: "a",
          date: 1,
          message: "m",
          changes: [{ path: "p", type: "frobnicate", delta: 1 }],
        },
      ],
    };
    expect(() => loadDemo(bad)).toThrow(AdapterError);
  });

  it("throws when commits is not an array", () => {
    expect(() => loadDemo({ repo: { name: "x", source: "demo" }, commits: {} })).toThrow(
      AdapterError,
    );
  });

  it("throws on non-object input", () => {
    expect(() => loadDemo(null)).toThrow(AdapterError);
    expect(() => loadDemo("nope")).toThrow(AdapterError);
  });
});

// ===========================================================================
// normalizeGithub
// ===========================================================================
describe("normalizeGithub", () => {
  const list = githubPage as unknown as GithubCommitListItem[];

  function detailsFor(item: GithubCommitListItem): Map<string, GithubCommitDetail> {
    const m = new Map<string, GithubCommitDetail>();
    // attach the shared detail fixture's files to the given commit
    const d = githubDetail as unknown as GithubCommitDetail;
    m.set(item.sha, { ...item, files: d.files });
    return m;
  }

  it("maps all five statuses, skipping unknown ones", () => {
    const item = list[1]; // Grace Hopper
    const { timeline } = normalizeGithub([[item]], detailsFor(item), "octo", "repo");
    const changes = timeline.commits[0].changes;
    // detail fixture has 6 files; "changed" is unknown → skipped → 5 changes
    expect(changes).toHaveLength(5);

    const byPath = (p: string) => changes.find((c) => c.path === p || c.toPath === p);
    expect(byPath("src/new.ts")!.type).toBe("add");
    expect(byPath("src/main.ts")!.type).toBe("modify");
    expect(byPath("src/old.ts")!.type).toBe("delete");
  });

  it("renamed: path=previous_filename, toPath=filename", () => {
    const item = list[1];
    const { timeline } = normalizeGithub([[item]], detailsFor(item), "octo", "repo");
    const rename = timeline.commits[0].changes.find((c) => c.toPath === "src/renamed.ts");
    expect(rename).toBeDefined();
    expect(rename!.type).toBe("rename");
    expect(rename!.path).toBe("src/before.ts");
    expect(rename!.toPath).toBe("src/renamed.ts");
  });

  it("copied maps to rename with path=previous_filename, toPath=filename", () => {
    const item = list[1];
    const { timeline } = normalizeGithub([[item]], detailsFor(item), "octo", "repo");
    const copy = timeline.commits[0].changes.find((c) => c.toPath === "src/copy.ts");
    expect(copy).toBeDefined();
    expect(copy!.type).toBe("rename");
    expect(copy!.path).toBe("src/source.ts");
  });

  it("delta = additions + deletions", () => {
    const item = list[1];
    const { timeline } = normalizeGithub([[item]], detailsFor(item), "octo", "repo");
    const changes = timeline.commits[0].changes;
    expect(changes.find((c) => c.path === "src/new.ts")!.delta).toBe(40); // 40 + 0
    expect(changes.find((c) => c.path === "src/main.ts")!.delta).toBe(14); // 10 + 4
    expect(changes.find((c) => c.path === "src/old.ts")!.delta).toBe(25); // 0 + 25
  });

  it("author falls back to committer name when commit.author is null", () => {
    const item = list[2]; // author null, committer "CI Bot"
    const m = new Map<string, GithubCommitDetail>();
    m.set(item.sha, { ...item, files: [] });
    const { timeline } = normalizeGithub([[item]], m, "octo", "repo");
    expect(timeline.commits[0].author).toBe("CI Bot");
  });

  it("sets repo owner/source for github", () => {
    const item = list[0];
    const m = new Map<string, GithubCommitDetail>();
    m.set(item.sha, { ...item, files: [] });
    const { timeline } = normalizeGithub([[item]], m, "octo", "myrepo");
    expect(timeline.repo).toEqual({ name: "myrepo", owner: "octo", source: "github" });
  });

  it("sorts result by date ascending", () => {
    const m = new Map<string, GithubCommitDetail>();
    for (const item of list) m.set(item.sha, { ...item, files: [] });
    const { timeline } = normalizeGithub([list], m, "octo", "repo");
    const dates = timeline.commits.map((c) => c.date);
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });

  it("counts commits missing from the details map as skipped", () => {
    // Provide details for only 2 of the 4 list items.
    const m = new Map<string, GithubCommitDetail>();
    m.set(list[0].sha, { ...list[0], files: [] });
    m.set(list[1].sha, { ...list[1], files: [] });
    const { timeline, skipped } = normalizeGithub([list], m, "octo", "repo");
    expect(timeline.commits).toHaveLength(2);
    expect(skipped).toBe(2);
  });

  it("skips and counts commits with no usable date", () => {
    const item: GithubCommitListItem = {
      sha: "nodate",
      commit: { author: null, committer: null, message: "no date" },
    };
    const m = new Map<string, GithubCommitDetail>();
    m.set(item.sha, { ...item, files: [] });
    const { timeline, skipped } = normalizeGithub([[item]], m, "octo", "repo");
    expect(timeline.commits).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("caps to MAX_COMMITS keeping the MOST RECENT", () => {
    const N = MAX_COMMITS + 5;
    const synthList: GithubCommitListItem[] = [];
    const m = new Map<string, GithubCommitDetail>();
    const base = Date.parse("2020-01-01T00:00:00Z");
    for (let i = 0; i < N; i++) {
      const sha = `sha-${i}`;
      const iso = new Date(base + i * 1000).toISOString();
      const item: GithubCommitListItem = {
        sha,
        commit: { author: { name: "a", date: iso }, message: `c${i}` },
      };
      synthList.push(item);
      m.set(sha, { ...item, files: [] });
    }
    const { timeline } = normalizeGithub([synthList], m, "octo", "repo");
    expect(timeline.commits).toHaveLength(MAX_COMMITS);
    // The most recent commit (c{N-1}) must be present; the oldest (c0) dropped.
    expect(timeline.commits[timeline.commits.length - 1].message).toBe(`c${N - 1}`);
    expect(timeline.commits.find((c) => c.message === "c0")).toBeUndefined();
    expect(timeline.commits[0].message).toBe(`c${N - MAX_COMMITS}`);
  });
});

// ===========================================================================
// normalizeLocal
// ===========================================================================
describe("normalizeLocal", () => {
  function entry(over: Partial<LocalLogEntry>): LocalLogEntry {
    return {
      oid: "oid",
      author: "Dev",
      timestamp: 1000,
      message: "msg",
      changes: [],
      ...over,
    };
  }

  it("converts timestamp seconds → ms", () => {
    const { timeline } = normalizeLocal([entry({ timestamp: 1700000000 })], "repo");
    expect(timeline.commits[0].date).toBe(1700000000 * 1000);
  });

  it("sorts ascending by date", () => {
    const entries = [
      entry({ oid: "b", timestamp: 300 }),
      entry({ oid: "a", timestamp: 100 }),
      entry({ oid: "c", timestamp: 200 }),
    ];
    const { timeline } = normalizeLocal(entries, "repo");
    expect(timeline.commits.map((c) => c.hash)).toEqual(["a", "c", "b"]);
  });

  it("sets repo source to local with no owner", () => {
    const { timeline } = normalizeLocal([entry({})], "my-local-repo");
    expect(timeline.repo).toEqual({ name: "my-local-repo", source: "local" });
    expect(timeline.repo.owner).toBeUndefined();
  });

  it("preserves changes incl. toPath", () => {
    const { timeline } = normalizeLocal(
      [
        entry({
          changes: [
            { path: "a.ts", type: "rename", delta: 0, toPath: "b.ts" },
            { path: "c.ts", type: "add", delta: 5 },
          ],
        }),
      ],
      "repo",
    );
    const ch = timeline.commits[0].changes;
    expect(ch[0]).toEqual({ path: "a.ts", type: "rename", delta: 0, toPath: "b.ts" });
    expect(ch[1]).toEqual({ path: "c.ts", type: "add", delta: 5 });
  });

  it("caps to MAX_COMMITS keeping the most recent", () => {
    const N = MAX_COMMITS + 10;
    const entries: LocalLogEntry[] = [];
    for (let i = 0; i < N; i++) entries.push(entry({ oid: `o${i}`, timestamp: i }));
    const { timeline } = normalizeLocal(entries, "repo");
    expect(timeline.commits).toHaveLength(MAX_COMMITS);
    // oldest kept = o{N-MAX}, newest = o{N-1}
    expect(timeline.commits[0].hash).toBe(`o${N - MAX_COMMITS}`);
    expect(timeline.commits[timeline.commits.length - 1].hash).toBe(`o${N - 1}`);
  });
});
