import { describe, it, expect } from "vitest";
import { computeKeymapDiff } from "./keymapDiff";
import type { KeyBinding } from "./ipc";

describe("computeKeymapDiff", () => {
  it("returns empty diff when all bindings match defaults", () => {
    const defaults: KeyBinding[] = [
      { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
      { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
    ];
    const current: KeyBinding[] = [
      { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
      { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
    ];
    expect(computeKeymapDiff(current, defaults)).toEqual([]);
  });

  it("includes changed key for a command", () => {
    const defaults: KeyBinding[] = [
      { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
    ];
    const current: KeyBinding[] = [
      { command: "editor.toggleBold", key: "Mod-x", when: "editorFocus", source: "user" },
    ];
    const diff = computeKeymapDiff(current, defaults);
    expect(diff).toEqual([
      { command: "editor.toggleBold", key: "Mod-x", when: "editorFocus" },
    ]);
  });

  it("includes new command not in defaults", () => {
    const defaults: KeyBinding[] = [
      { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
    ];
    const current: KeyBinding[] = [
      { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
      { command: "custom.newCommand", key: "Mod-n", source: "user" },
    ];
    const diff = computeKeymapDiff(current, defaults);
    expect(diff).toEqual([
      { command: "custom.newCommand", key: "Mod-n" },
    ]);
  });

  it("includes disabled marker when default command removed from current", () => {
    const defaults: KeyBinding[] = [
      { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
      { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
    ];
    const current: KeyBinding[] = [
      { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
    ];
    const diff = computeKeymapDiff(current, defaults);
    expect(diff).toEqual([
      { command: "editor.toggleBold", key: "", when: "editorFocus" },
    ]);
  });

  it("strips source field from output", () => {
    const defaults: KeyBinding[] = [
      { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
    ];
    const current: KeyBinding[] = [
      { command: "editor.toggleBold", key: "Mod-x", when: "editorFocus", source: "user" },
    ];
    const diff = computeKeymapDiff(current, defaults);
    for (const entry of diff) {
      expect(entry).not.toHaveProperty("source");
    }
  });

  it("uses normalized key comparison (Mod-B vs Mod-b → no diff)", () => {
    const defaults: KeyBinding[] = [
      { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
    ];
    const current: KeyBinding[] = [
      { command: "editor.toggleBold", key: "Mod-B", when: "editorFocus", source: "default" },
    ];
    expect(computeKeymapDiff(current, defaults)).toEqual([]);
  });

  it("multi-binding command: one slot changed, other unchanged → only changed slot in diff", () => {
    const defaults: KeyBinding[] = [
      { command: "editor.save", key: "Mod-s", source: "default" },
      { command: "editor.save", key: "Ctrl-s", when: "editorFocus", source: "default" },
    ];
    const current: KeyBinding[] = [
      { command: "editor.save", key: "Mod-s", source: "default" },
      { command: "editor.save", key: "Mod-Shift-s", when: "editorFocus", source: "user" },
    ];
    const diff = computeKeymapDiff(current, defaults);
    expect(diff).toEqual([
      { command: "editor.save", key: "Mod-Shift-s", when: "editorFocus" },
    ]);
  });

  it("when context differs → treated as separate slots", () => {
    const defaults: KeyBinding[] = [
      { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
      { command: "editor.toggleBold", key: "Mod-b", source: "default" },
    ];
    const current: KeyBinding[] = [
      { command: "editor.toggleBold", key: "Mod-x", when: "editorFocus", source: "user" },
      { command: "editor.toggleBold", key: "Mod-b", source: "default" },
    ];
    const diff = computeKeymapDiff(current, defaults);
    expect(diff).toEqual([
      { command: "editor.toggleBold", key: "Mod-x", when: "editorFocus" },
    ]);
  });
});
