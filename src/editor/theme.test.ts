import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  editorTheme,
  editorDarkTheme,
  highlightExtension,
  getThemeExtension,
  searchTheme,
} from "./theme";

describe("theme", () => {
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
