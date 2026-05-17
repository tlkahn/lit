import { describe, it, expect } from "vitest";
import { normalizeKeyNotation, keysEqual } from "./normalizeKeyNotation";

describe("normalizeKeyNotation", () => {
  it("lowercases single-char keys", () => {
    expect(normalizeKeyNotation("Mod-B")).toBe("Mod-b");
  });

  it("preserves multi-char key case", () => {
    expect(normalizeKeyNotation("Mod-Enter")).toBe("Mod-Enter");
  });

  it("canonicalizes modifier order: Alt-Mod → Mod-Alt", () => {
    expect(normalizeKeyNotation("Alt-Mod-k")).toBe("Mod-Alt-k");
  });

  it("canonicalizes modifier order: Shift-Ctrl-Mod → Ctrl-Mod-Shift", () => {
    expect(normalizeKeyNotation("Shift-Ctrl-Mod-x")).toBe("Ctrl-Mod-Shift-x");
  });

  it("returns plain key unchanged", () => {
    expect(normalizeKeyNotation("a")).toBe("a");
  });

  it("handles minus key edge case", () => {
    expect(normalizeKeyNotation("Ctrl--")).toBe("Ctrl--");
  });

  it("preserves Space key", () => {
    expect(normalizeKeyNotation("Mod-Space")).toBe("Mod-Space");
  });

  it("normalizes each chord in a multi-chord sequence", () => {
    expect(normalizeKeyNotation("Mod-K Mod-S")).toBe("Mod-k Mod-s");
  });
});

describe("keysEqual", () => {
  it("returns true for case-different single-char keys", () => {
    expect(keysEqual("Mod-b", "Mod-B")).toBe(true);
  });

  it("returns true for different modifier order", () => {
    expect(keysEqual("Alt-Mod-k", "Mod-Alt-k")).toBe(true);
  });

  it("returns false for different modifiers", () => {
    expect(keysEqual("Mod-b", "Mod-Shift-b")).toBe(false);
  });
});
