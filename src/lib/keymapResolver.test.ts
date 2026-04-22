import { describe, it, expect, beforeEach } from "vitest";
import { commandRegistry } from "./commands";
import { resolveKeymaps } from "./keymapResolver";

describe("resolveKeymaps", () => {
  beforeEach(() => {
    commandRegistry._clear();
  });

  it("splits bindings into editor and app groups by command prefix", () => {
    commandRegistry.register("editor.toggleBold", () => true);
    commandRegistry.register("app.newPage", () => true);

    const result = resolveKeymaps([
      { key: "Mod-b", command: "editor.toggleBold", when: "editorFocus" },
      { key: "Mod-Shift-n", command: "app.newPage" },
    ]);

    expect(result.editorBindings).toHaveLength(1);
    expect(result.appBindings).toHaveLength(1);
  });

  it("converts editor binding to CM6 KeyBinding format", () => {
    commandRegistry.register("editor.toggleBold", () => true);

    const result = resolveKeymaps([
      { key: "Mod-b", command: "editor.toggleBold" },
    ]);

    expect(result.editorBindings[0]!.key).toBe("Mod-b");
    expect(typeof result.editorBindings[0]!.run).toBe("function");
  });

  it("converts app binding to AppBinding format", () => {
    commandRegistry.register("app.newPage", () => true);

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
