import { describe, it, expect } from "vitest";
import { parseKeyString, formatKeyForDisplay, formatChordSequence } from "./keyChordFormat";

describe("parseKeyString", () => {
  it("parses Mod-Shift-k", () => {
    expect(parseKeyString("Mod-Shift-k")).toEqual({
      modifiers: ["Mod", "Shift"],
      key: "k",
    });
  });

  it("parses Ctrl-- (trailing dash is the key)", () => {
    expect(parseKeyString("Ctrl--")).toEqual({
      modifiers: ["Ctrl"],
      key: "-",
    });
  });

  it("parses a plain key", () => {
    expect(parseKeyString("a")).toEqual({
      modifiers: [],
      key: "a",
    });
  });

  it("parses Mod-b", () => {
    expect(parseKeyString("Mod-b")).toEqual({
      modifiers: ["Mod"],
      key: "b",
    });
  });

  it("parses Alt-Shift-/", () => {
    expect(parseKeyString("Alt-Shift-/")).toEqual({
      modifiers: ["Alt", "Shift"],
      key: "/",
    });
  });

  it("parses Ctrl-Shift--", () => {
    expect(parseKeyString("Ctrl-Shift--")).toEqual({
      modifiers: ["Ctrl", "Shift"],
      key: "-",
    });
  });
});

describe("formatKeyForDisplay", () => {
  it("formats Mod-Shift-k on mac", () => {
    const parsed = parseKeyString("Mod-Shift-k");
    expect(formatKeyForDisplay(parsed, "mac")).toBe("⌘⇧K");
  });

  it("formats Mod-Shift-k on other", () => {
    const parsed = parseKeyString("Mod-Shift-k");
    expect(formatKeyForDisplay(parsed, "other")).toBe("Ctrl+Shift+K");
  });

  it("formats Mod-b on mac", () => {
    const parsed = parseKeyString("Mod-b");
    expect(formatKeyForDisplay(parsed, "mac")).toBe("⌘B");
  });

  it("formats plain key", () => {
    const parsed = parseKeyString("a");
    expect(formatKeyForDisplay(parsed, "mac")).toBe("A");
  });

  it("formats Alt modifier on mac", () => {
    const parsed = parseKeyString("Alt-x");
    expect(formatKeyForDisplay(parsed, "mac")).toBe("⌥X");
  });

  it("formats Ctrl modifier on mac (not Mod)", () => {
    const parsed = parseKeyString("Ctrl-x");
    expect(formatKeyForDisplay(parsed, "mac")).toBe("⌃X");
  });

  it("formats special key symbols", () => {
    const parsed = parseKeyString("Mod-/");
    expect(formatKeyForDisplay(parsed, "mac")).toBe("⌘/");
  });
});

describe("formatChordSequence", () => {
  it("formats single chord on mac", () => {
    expect(formatChordSequence("Mod-b", "mac")).toBe("⌘B");
  });

  it("formats multi-chord sequence on mac", () => {
    expect(formatChordSequence("Mod-k Mod-s", "mac")).toBe("⌘K ⌘S");
  });

  it("formats single chord on other", () => {
    expect(formatChordSequence("Mod-b", "other")).toBe("Ctrl+B");
  });

  it("formats multi-chord sequence on other", () => {
    expect(formatChordSequence("Mod-k Mod-s", "other")).toBe("Ctrl+K Ctrl+S");
  });

  it("returns empty string for empty input", () => {
    expect(formatChordSequence("", "mac")).toBe("");
  });
});
