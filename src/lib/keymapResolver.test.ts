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
  it("contains Mod-Shift-g binding for app.showGraphView", () => {
    const entry = defaultKeymaps.find(
      (b: { key: string; command: string }) =>
        b.key === "Mod-Shift-g" && b.command === "app.showGraphView",
    );
    expect(entry).toBeDefined();
  });
});
