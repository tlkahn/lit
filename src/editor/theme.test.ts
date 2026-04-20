import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  lightTheme,
  darkTheme,
  lightHighlightStyle,
  darkHighlightStyle,
  getThemeExtension,
  getHighlightExtension,
} from "./theme";

describe("theme", () => {
  it("lightTheme is a valid Extension", () => {
    expect(() => EditorState.create({ extensions: [lightTheme] })).not.toThrow();
  });

  it("darkTheme is a valid Extension", () => {
    expect(() => EditorState.create({ extensions: [darkTheme] })).not.toThrow();
  });

  it("lightHighlightStyle is a valid HighlightStyle", () => {
    expect(lightHighlightStyle).toBeDefined();
    expect(lightHighlightStyle.module).toBeDefined();
  });

  it("darkHighlightStyle is a valid HighlightStyle", () => {
    expect(darkHighlightStyle).toBeDefined();
    expect(darkHighlightStyle.module).toBeDefined();
  });

  it("getThemeExtension returns light/dark based on arg", () => {
    expect(getThemeExtension("light")).toBe(lightTheme);
    expect(getThemeExtension("dark")).toBe(darkTheme);
  });

  it("getHighlightExtension returns valid extensions", () => {
    expect(() =>
      EditorState.create({ extensions: [getHighlightExtension("light")] }),
    ).not.toThrow();
    expect(() =>
      EditorState.create({ extensions: [getHighlightExtension("dark")] }),
    ).not.toThrow();
  });
});
