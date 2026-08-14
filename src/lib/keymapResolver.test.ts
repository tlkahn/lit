import { describe, it, expect, beforeEach } from "vitest";
import { registerHandler, _clear } from "./commandRegistry";
import { resolveKeymaps } from "./keymapResolver";
import defaultKeymaps from "../../keymaps/default.json";

describe("resolveKeymaps", () => {
  beforeEach(() => {
    _clear();
  });

  it("splits bindings into editor and app groups by command prefix", () => {
    registerHandler("editor.toggleBold", () => true);
    registerHandler("app.newPage", () => true);

    const result = resolveKeymaps([
      { key: "Mod-b", command: "editor.toggleBold", when: "editorFocus" },
      { key: "Mod-Shift-n", command: "app.newPage" },
    ]);

    expect(result.editorBindings).toHaveLength(1);
    expect(result.appBindings).toHaveLength(1);
  });

  it("converts editor binding to CM6 KeyBinding format", () => {
    registerHandler("editor.toggleBold", () => true);

    const result = resolveKeymaps([
      { key: "Mod-b", command: "editor.toggleBold" },
    ]);

    expect(result.editorBindings[0]!.key).toBe("Mod-b");
    expect(typeof result.editorBindings[0]!.run).toBe("function");
  });

  it("converts app binding to AppBinding format", () => {
    registerHandler("app.newPage", () => true);

    const result = resolveKeymaps([
      { key: "Mod-Shift-n", command: "app.newPage", when: "always" },
    ]);

    expect(result.appBindings[0]).toEqual({
      key: "Mod-Shift-n",
      command: "app.newPage",
      when: "always",
    });
  });

  it("unknown command in binding is silently skipped", () => {
    const result = resolveKeymaps([
      { key: "Mod-b", command: "editor.nonexistent" },
    ]);

    expect(result.editorBindings).toHaveLength(0);
    expect(result.appBindings).toHaveLength(0);
  });

  it("empty input returns empty arrays", () => {
    const result = resolveKeymaps([]);
    expect(result.editorBindings).toHaveLength(0);
    expect(result.appBindings).toHaveLength(0);
  });
});

describe("keymaps/default.json", () => {
  it("does not bind Mod-n in default keymaps (menu-owned chord)", () => {
    const entry = defaultKeymaps.find(
      (b: { key: string; command: string }) => b.key === "Mod-n",
    );
    expect(entry).toBeUndefined();
    const pageNew = defaultKeymaps.find(
      (b: { key: string; command: string }) => b.command === "core.page.new",
    );
    expect(pageNew).toBeUndefined();
  });

  it("does not bind Mod-Shift-n to app.newPage", () => {
    const entry = defaultKeymaps.find(
      (b: { key: string; command: string }) =>
        b.key === "Mod-Shift-n" && b.command === "app.newPage",
    );
    expect(entry).toBeUndefined();
  });

  it("contains Mod-g binding for editor.findNext", () => {
    const entry = defaultKeymaps.find(
      (b: { key: string; command: string }) =>
        b.key === "Mod-g" && b.command === "editor.findNext",
    );
    expect(entry).toBeDefined();
  });

  it("contains Mod-Shift-g binding for editor.findPrevious", () => {
    const entry = defaultKeymaps.find(
      (b: { key: string; command: string }) =>
        b.key === "Mod-Shift-g" && b.command === "editor.findPrevious",
    );
    expect(entry).toBeDefined();
  });

  it("contains Mod-3 binding for app.showGraphView", () => {
    const entry = defaultKeymaps.find(
      (b: { key: string; command: string }) =>
        b.key === "Mod-3" && b.command === "app.showGraphView",
    );
    expect(entry).toBeDefined();
  });

  it("selectNextOccurrence is bound to Ctrl-g (not Mod-d)", () => {
    const entry = defaultKeymaps.find(
      (b: { key: string; command: string }) =>
        b.command === "editor.selectNextOccurrence",
    );
    expect(entry?.key).toBe("Ctrl-g");
  });

  it("panel.toggleBottom is bound to Ctrl-` (not Mod-`)", () => {
    const entry = defaultKeymaps.find(
      (b: { key: string; command: string }) =>
        b.command === "panel.toggleBottom",
    );
    expect(entry?.key).toBe("Ctrl-`");
  });

  it("contains Mod-Shift-o binding for companion.open", () => {
    const entry = defaultKeymaps.find(
      (b: { key: string; command: string }) =>
        b.key === "Mod-Shift-o" && b.command === "companion.open",
    );
    expect(entry).toBeDefined();
  });

  it("contains Mod-Shift-m binding for app.toggleAllBlockAnnotations (global, no when clause)", () => {
    const entry = defaultKeymaps.find(
      (b: { key: string; command: string; when?: string }) =>
        b.key === "Mod-Shift-m" && b.command === "app.toggleAllBlockAnnotations",
    );
    expect(entry).toBeDefined();
    expect((entry as Record<string, unknown>).when).toBeUndefined();
  });

  it("contains pane keybindings in default.json", () => {
    const find = (cmd: string) =>
      defaultKeymaps.find((b: { key: string; command: string }) => b.command === cmd);
    expect(find("pane.splitRight")).toEqual(expect.objectContaining({ key: "Mod-d" }));
    expect(find("pane.splitDown")).toEqual(expect.objectContaining({ key: "Mod-Shift-d" }));
    expect(find("pane.focusNext")).toEqual(expect.objectContaining({ key: "Mod-Alt-ArrowRight" }));
    expect(find("pane.focusPrev")).toEqual(expect.objectContaining({ key: "Mod-Alt-ArrowLeft" }));
    expect(find("pane.focusContentNext")).toEqual(expect.objectContaining({ key: "Mod-Shift-]" }));
    expect(find("pane.focusContentPrev")).toEqual(expect.objectContaining({ key: "Mod-Shift-[" }));
    expect(find("pane.historyBack")).toEqual(expect.objectContaining({ key: "Mod-[" }));
    expect(find("pane.historyForward")).toEqual(expect.objectContaining({ key: "Mod-]" }));
  });
});
