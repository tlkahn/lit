import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { EditorState } from "@codemirror/state";
import {
  editorTheme,
  editorDarkTheme,
  highlightExtension,
  getThemeExtension,
  searchTheme,
  editorBaseThemeSpec,
  codeEditorContentThemeSpec,
} from "./theme";

describe("theme", () => {
  it("editorBaseThemeSpec sets the editor root to pane width", () => {
    const root = editorBaseThemeSpec["&"];
    expect(root).toBeDefined();
    expect(root!.width).toBe("100%");
    expect(root!.minWidth).toBe(0);
    expect(root!.height).toBe("100%");
  });

  it("editorBaseThemeSpec keeps content within the scroller width", () => {
    const content = editorBaseThemeSpec[".cm-content"];
    expect(content).toBeDefined();
    expect(content!.minWidth).toBe(0);
    expect(content!.maxWidth).toBe("100%");
    expect(content!.overflowX).toBe("clip");
  });

  it("codeEditorContentThemeSpec lets content exceed the scroller width", () => {
    const content = codeEditorContentThemeSpec[".cm-content"];
    expect(content).toBeDefined();
    expect(content!.maxWidth).toBe("none");
    expect(content!.overflowX).toBe("visible");
  });

  it("editorTheme is a valid Extension", () => {
    expect(() => EditorState.create({ extensions: [editorTheme] })).not.toThrow();
  });

  it("editorDarkTheme is a valid Extension", () => {
    expect(() => EditorState.create({ extensions: [editorDarkTheme] })).not.toThrow();
  });

  it("highlightExtension is a valid Extension", () => {
    expect(() =>
      EditorState.create({ extensions: [highlightExtension] }),
    ).not.toThrow();
  });

  it("getThemeExtension returns light/dark based on arg", () => {
    expect(getThemeExtension("light")).toBe(editorTheme);
    expect(getThemeExtension("dark")).toBe(editorDarkTheme);
  });

  it("searchTheme is a valid Extension", () => {
    expect(() => EditorState.create({ extensions: [searchTheme] })).not.toThrow();
  });
});

describe("monospace size scaling (#1059)", () => {
  const indexCss = readFileSync(resolve(__dirname, "../index.css"), "utf-8");

  it(".tok-monospace scales via the ratio", () => {
    const rule = indexCss.match(/\.tok-monospace\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("font-size: calc(var(--font-monospace-size-ratio, 0.875) * 1em)");
  });

  it(".tok-monospace keeps the mono family so revealed backticks match previewed content (#238 parity)", () => {
    const rule = indexCss.match(/\.tok-monospace\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("font-family: var(--font-monospace-theme");
  });
});
