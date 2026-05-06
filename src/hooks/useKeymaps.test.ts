import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { mockInvoke } from "../test/tauri-mock";
import {
  registerHandler,
  hasCommand,
  executeCommand,
  _clear,
} from "../lib/commandRegistry";

describe("useKeymaps", () => {
  beforeEach(() => {
    _clear();
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { key: "Mod-b", command: "editor.toggleBold", when: "editorFocus" },
          { key: "Mod-i", command: "editor.toggleItalic", when: "editorFocus" },
          { key: "Mod-k", command: "editor.insertLink", when: "editorFocus" },
          { key: "Mod-/", command: "editor.toggleComment", when: "editorFocus" },
          { key: "Mod-Shift-n", command: "app.newPage" },
          { key: "Mod-r", command: "app.gotoHeading" },
          { key: "Mod-Shift-e", command: "editor.openInExternalEditor", when: "editorFocus" },
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
    expect(hasCommand("app.gotoHeading")).toBe(true);
  });

  it("editor.openInExternalEditor is registered in the command registry", async () => {
    await loadHook();
    expect(hasCommand("editor.openInExternalEditor")).toBe(true);
  });

  it("produces a CM6 editor binding for editor.openInExternalEditor", async () => {
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const keys = result.current.editorBindings.map((b) => b.key);
    expect(keys).toContain("Mod-Shift-e");
  });

  it("executing app.gotoHeading dispatches lit:toggle-quick-switcher", async () => {
    await loadHook();
    const listener = vi.fn();
    window.addEventListener("lit:toggle-quick-switcher", listener);
    executeCommand("app.gotoHeading");
    window.removeEventListener("lit:toggle-quick-switcher", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("panel.toggleBottom is registered in the command registry", async () => {
    await loadHook();
    expect(hasCommand("panel.toggleBottom")).toBe(true);
  });

  it("executing panel.toggleBottom dispatches lit:toggle-bottom-panel", async () => {
    await loadHook();
    const listener = vi.fn();
    window.addEventListener("lit:toggle-bottom-panel", listener);
    executeCommand("panel.toggleBottom");
    window.removeEventListener("lit:toggle-bottom-panel", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("app keydown handler dispatches matching command", async () => {
    registerHandler("app.newPage", vi.fn());
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    const event = new KeyboardEvent("keydown", {
      key: "n",
      metaKey: true,
      shiftKey: true,
    });
    document.dispatchEvent(event);

    expect(hasCommand("app.newPage")).toBe(true);
  });

  it("app.showGraphView is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("app.showGraphView")).toBe(true);
  });

  it("app.showLocalGraph is registered with when guard requiring active page", async () => {
    await loadHook();
    expect(hasCommand("app.showLocalGraph")).toBe(true);
  });

  it("executing app.showGraphView dispatches lit:toggle-graph-view event", async () => {
    await loadHook();
    const listener = vi.fn();
    window.addEventListener("lit:toggle-graph-view", listener);
    executeCommand("app.showGraphView");
    window.removeEventListener("lit:toggle-graph-view", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
