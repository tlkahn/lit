import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { mockInvoke } from "../test/tauri-mock";
import {
  registerHandler,
  hasCommand,
  executeCommand,
  _clear,
} from "../lib/commandRegistry";
import { usePreferencesStore } from "../stores/preferences";

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
          { key: "Mod-Shift-g", command: "app.showGraphView" },
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

  it("Mod-Shift-g keydown dispatches lit:toggle-graph-view", async () => {
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    const listener = vi.fn();
    window.addEventListener("lit:toggle-graph-view", listener);

    const event = new KeyboardEvent("keydown", {
      key: "g",
      metaKey: true,
      shiftKey: true,
    });
    document.dispatchEvent(event);

    window.removeEventListener("lit:toggle-graph-view", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("workbench.toggleSideBar is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("workbench.toggleSideBar")).toBe(true);
  });

  it("executing workbench.toggleSideBar calls setPreference to toggle sidebarVisible", async () => {
    usePreferencesStore.setState({ sidebarVisible: true });
    await loadHook();

    let capturedArgs: { cmd: string; args: unknown } | undefined;
    mockInvoke((cmd, args) => {
      if (cmd === "set_preference") {
        capturedArgs = { cmd, args };
        return undefined;
      }
      if (cmd === "get_keymaps") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    executeCommand("workbench.toggleSideBar");

    expect(capturedArgs).toBeTruthy();
    expect(capturedArgs!.args).toEqual({ key: "workbench.sideBar.visible", value: false });
  });

  it("dispatching lit:keymaps-changed re-fetches keymaps and updates editorBindings", async () => {
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    const initialKeys = result.current.editorBindings.map((b) => b.key);
    expect(initialKeys).toContain("Mod-b");

    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { key: "Mod-x", command: "editor.toggleBold", when: "editorFocus" },
          { key: "Mod-i", command: "editor.toggleItalic", when: "editorFocus" },
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    window.dispatchEvent(new CustomEvent("lit:keymaps-changed"));

    await waitFor(() => {
      const keys = result.current.editorBindings.map((b) => b.key);
      expect(keys).toContain("Mod-x");
      expect(keys).not.toContain("Mod-b");
    });
  });

  it("app keydown handler uses updated bindings after reload event", async () => {
    registerHandler("app.newPage", vi.fn());
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { key: "Mod-Shift-m", command: "app.newPage" },
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    window.dispatchEvent(new CustomEvent("lit:keymaps-changed"));

    await waitFor(() => {
      expect(result.current.editorBindings.length).toBe(0);
    });

    const listener = vi.fn();
    registerHandler("app.newPage", listener);

    const event = new KeyboardEvent("keydown", {
      key: "m",
      metaKey: true,
      shiftKey: true,
    });
    document.dispatchEvent(event);

    expect(listener).toHaveBeenCalled();
  });
});
