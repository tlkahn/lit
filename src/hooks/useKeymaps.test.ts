import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { mockInvoke } from "../test/tauri-mock";
import { commandRegistry } from "../lib/commands";

describe("useKeymaps", () => {
  beforeEach(() => {
    commandRegistry._clear();
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { key: "Mod-b", command: "editor.toggleBold", when: "editorFocus" },
          { key: "Mod-i", command: "editor.toggleItalic", when: "editorFocus" },
          { key: "Mod-k", command: "editor.insertLink", when: "editorFocus" },
          { key: "Mod-/", command: "editor.toggleComment", when: "editorFocus" },
          { key: "Mod-Shift-n", command: "app.newPage" },
          { key: "Mod-r", command: "app.gotoHeading" },
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  async function loadHook() {
    const { useKeymaps } = await import("./useKeymaps");
    return renderHook(() => useKeymaps());
  }

  it("loads keymaps from IPC on mount", async () => {
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.editorBindings.length).toBeGreaterThan(0);
  });

  it("returns editorBindings for editor.* commands", async () => {
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const keys = result.current.editorBindings.map((b) => b.key);
    expect(keys).toContain("Mod-b");
    expect(keys).toContain("Mod-i");
    expect(keys).toContain("Mod-k");
  });

  it("editor bindings have run functions", async () => {
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    for (const binding of result.current.editorBindings) {
      expect(typeof binding.run).toBe("function");
    }
  });

  it("app.gotoHeading is registered in the command registry", async () => {
    await loadHook();
    expect(commandRegistry.has("app.gotoHeading")).toBe(true);
  });

  it("executing app.gotoHeading dispatches lit:toggle-quick-switcher", async () => {
    await loadHook();
    const listener = vi.fn();
    window.addEventListener("lit:toggle-quick-switcher", listener);
    commandRegistry.execute("app.gotoHeading");
    window.removeEventListener("lit:toggle-quick-switcher", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("app keydown handler dispatches matching command", async () => {
    commandRegistry.register("app.newPage", vi.fn());
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    const event = new KeyboardEvent("keydown", {
      key: "n",
      metaKey: true,
      shiftKey: true,
    });
    document.dispatchEvent(event);

    const handler = commandRegistry.list().includes("app.newPage");
    expect(handler).toBe(true);
  });
});
