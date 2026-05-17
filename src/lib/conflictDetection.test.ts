import { describe, it, expect } from "vitest";
import { contextsOverlap, detectConflicts, applyRebind } from "./conflictDetection";
import type { KeyBinding } from "./ipc";

describe("contextsOverlap", () => {
  it("both global → true", () => {
    expect(contextsOverlap(undefined, undefined)).toBe(true);
  });

  it("global shadows scoped → true", () => {
    expect(contextsOverlap(undefined, "editorFocus")).toBe(true);
  });

  it("scoped conflicts with global → true", () => {
    expect(contextsOverlap("editorFocus", undefined)).toBe(true);
  });

  it("same context → true", () => {
    expect(contextsOverlap("editorFocus", "editorFocus")).toBe(true);
  });

  it("different non-null contexts → false", () => {
    expect(contextsOverlap("editorFocus", "listFocus")).toBe(false);
  });

  it("null treated as global (null vs undefined) → true", () => {
    expect(contextsOverlap(null, undefined)).toBe(true);
  });

  it("null treated as global (null vs scoped) → true", () => {
    expect(contextsOverlap(null, "editorFocus")).toBe(true);
  });
});

describe("detectConflicts", () => {
  const bindings: KeyBinding[] = [
    { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
    { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "user" },
    { command: "workbench.toggleSideBar", key: "Mod-b", source: "default" },
    { command: "app.commandPalette", key: "Mod-p", source: "menu" },
  ];

  it("returns empty array when key is unused", () => {
    expect(detectConflicts("Mod-x", undefined, bindings)).toEqual([]);
  });

  it("detects conflict: same key + same when context", () => {
    const result = detectConflicts("Mod-b", "editorFocus", bindings);
    expect(result).toContainEqual(
      expect.objectContaining({ command: "editor.toggleBold" }),
    );
  });

  it("no false positive: same key + different when", () => {
    const result = detectConflicts("Mod-b", "listFocus", bindings);
    expect(result).not.toContainEqual(
      expect.objectContaining({ command: "editor.toggleBold" }),
    );
  });

  it("global binding conflicts with any context", () => {
    const result = detectConflicts("Mod-b", "listFocus", bindings);
    expect(result).toContainEqual(
      expect.objectContaining({ command: "workbench.toggleSideBar" }),
    );
  });

  it("normalizes key before comparing (case-insensitive)", () => {
    const result = detectConflicts("Mod-B", "editorFocus", bindings);
    expect(result).toContainEqual(
      expect.objectContaining({ command: "editor.toggleBold" }),
    );
  });

  it("normalizes modifier order before comparing", () => {
    const customBindings: KeyBinding[] = [
      { command: "custom.cmd", key: "Alt-Mod-k", when: "editorFocus", source: "default" },
    ];
    const result = detectConflicts("Mod-Alt-k", "editorFocus", customBindings);
    expect(result).toHaveLength(1);
    expect(result[0]!.command).toBe("custom.cmd");
  });

  it("excludes self via excludeCommand parameter", () => {
    const result = detectConflicts("Mod-b", "editorFocus", bindings, "editor.toggleBold");
    expect(result).not.toContainEqual(
      expect.objectContaining({ command: "editor.toggleBold" }),
    );
  });

  it("returns multiple conflicts for same key in overlapping contexts", () => {
    const result = detectConflicts("Mod-b", "editorFocus", bindings);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("identifies menu-source conflicts", () => {
    const result = detectConflicts("Mod-p", undefined, bindings);
    expect(result).toContainEqual(
      expect.objectContaining({ command: "app.commandPalette", source: "menu" }),
    );
  });
});

describe("applyRebind", () => {
  const bindings: KeyBinding[] = [
    { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
    { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "user" },
    { command: "workbench.toggleSideBar", key: "Mod-\\", source: "default" },
  ];

  it("removes the conflicting command's binding", () => {
    const conflicting = bindings[0]!;
    const result = applyRebind(bindings, "Mod-b", "workbench.openFile", "editorFocus", conflicting);
    expect(result.find((b) => b.command === "editor.toggleBold")).toBeUndefined();
  });

  it("adds the new binding for the target command", () => {
    const conflicting = bindings[0]!;
    const result = applyRebind(bindings, "Mod-b", "workbench.openFile", "editorFocus", conflicting);
    expect(result).toContainEqual(
      expect.objectContaining({ command: "workbench.openFile", key: "Mod-b", when: "editorFocus" }),
    );
  });

  it("removes target command's previous binding in same context", () => {
    const withExisting: KeyBinding[] = [
      ...bindings,
      { command: "workbench.openFile", key: "Mod-o", when: "editorFocus", source: "user" },
    ];
    const conflicting = bindings[0]!;
    const result = applyRebind(withExisting, "Mod-b", "workbench.openFile", "editorFocus", conflicting);
    expect(result.filter((b) => b.command === "workbench.openFile")).toHaveLength(1);
    expect(result.find((b) => b.command === "workbench.openFile")!.key).toBe("Mod-b");
  });

  it("preserves unrelated bindings", () => {
    const conflicting = bindings[0]!;
    const result = applyRebind(bindings, "Mod-b", "workbench.openFile", "editorFocus", conflicting);
    expect(result).toContainEqual(
      expect.objectContaining({ command: "editor.toggleItalic", key: "Mod-i" }),
    );
    expect(result).toContainEqual(
      expect.objectContaining({ command: "workbench.toggleSideBar", key: "Mod-\\" }),
    );
  });

  it("does not mutate the input array", () => {
    const conflicting = bindings[0]!;
    const original = [...bindings];
    applyRebind(bindings, "Mod-b", "workbench.openFile", "editorFocus", conflicting);
    expect(bindings).toEqual(original);
  });
});
