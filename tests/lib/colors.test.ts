import { describe, it, expect } from "vitest";
import { langOf, colorOf } from "@/lib/colors";
import type { Theme } from "@/lib/colors";

describe("langOf", () => {
  it("maps .ts to ts", () => expect(langOf("src/foo.ts")).toBe("ts"));
  it("maps .tsx to ts", () => expect(langOf("src/Comp.tsx")).toBe("ts"));
  it("maps .js to js", () => expect(langOf("index.js")).toBe("js"));
  it("maps .jsx to js", () => expect(langOf("App.jsx")).toBe("js"));
  it("maps .mjs to js", () => expect(langOf("worker.mjs")).toBe("js"));
  it("maps .css to css", () => expect(langOf("styles.css")).toBe("css"));
  it("maps .scss to css", () => expect(langOf("theme.scss")).toBe("css"));
  it("maps .md to md", () => expect(langOf("README.md")).toBe("md"));
  it("maps .json to config", () => expect(langOf("package.json")).toBe("config"));
  it("maps .yml to config", () => expect(langOf(".github/ci.yml")).toBe("config"));
  it("maps .yaml to config", () => expect(langOf("docker-compose.yaml")).toBe("config"));
  it("maps .py to py", () => expect(langOf("script.py")).toBe("py"));
  it("maps .rs to rs", () => expect(langOf("main.rs")).toBe("rs"));
  it("maps .go to go", () => expect(langOf("server.go")).toBe("go"));
  it("maps .html to html", () => expect(langOf("index.html")).toBe("html"));
  it("maps unknown ext to other", () => expect(langOf("binary.wasm")).toBe("other"));
  it("maps no extension to other", () => expect(langOf("Makefile")).toBe("other"));
  it("is case-insensitive: .TS → ts", () => expect(langOf("Main.TS")).toBe("ts"));
  it("is case-insensitive: .JSON → config", () => expect(langOf("Data.JSON")).toBe("config"));
  it("handles dotfiles with no ext", () => expect(langOf(".gitignore")).toBe("other"));
  it("handles path with multiple dots", () => expect(langOf("lib/foo.test.ts")).toBe("ts"));
});

const THEMES: Theme[] = ["nebula", "ember", "mono"];
const LANG_KEYS = ["ts", "js", "css", "md", "config", "py", "rs", "go", "html", "other"];

describe("colorOf", () => {
  for (const theme of THEMES) {
    describe(`theme: ${theme}`, () => {
      it("returns RGB in [0,1] for all langs", () => {
        for (const lang of LANG_KEYS) {
          const [r, g, b] = colorOf(lang, theme);
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(1);
          expect(g).toBeGreaterThanOrEqual(0);
          expect(g).toBeLessThanOrEqual(1);
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(1);
        }
      });

      it("unknown lang falls back to 'other' color", () => {
        expect(colorOf("zig", theme)).toEqual(colorOf("other", theme));
        expect(colorOf("rust_plus_plus", theme)).toEqual(colorOf("other", theme));
      });
    });
  }

  it("distinct langs get distinct colors in nebula", () => {
    const seen = new Set<string>();
    for (const lang of LANG_KEYS) {
      const key = colorOf(lang, "nebula").join(",");
      expect(seen.has(key), `color for '${lang}' is a duplicate in nebula`).toBe(false);
      seen.add(key);
    }
  });

  it("returns a tuple of exactly 3 numbers", () => {
    const result = colorOf("ts", "nebula");
    expect(result).toHaveLength(3);
    expect(typeof result[0]).toBe("number");
    expect(typeof result[1]).toBe("number");
    expect(typeof result[2]).toBe("number");
  });
});
