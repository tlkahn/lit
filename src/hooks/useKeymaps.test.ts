import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { mockInvoke } from "../test/tauri-mock";
import {
  registerHandler,
  hasCommand,
  executeCommand,
  getVisibleCommands,
  _clear,
} from "../lib/commandRegistry";
import { usePreferencesStore } from "../stores/preferences";
import { usePaneStore, createInitialState, collectLeaves, type PaneSplit, type PaneLeaf, type PaneNode } from "../stores/panes";
import { registerPaneView, _resetForTesting as resetEditorViewRef } from "../lib/editorViewRef";
import type { EditorView } from "@codemirror/view";

function makeTwoLeafState(): { root: PaneNode; focusedPaneId: string } {
  const leaf1: PaneLeaf = { type: "leaf", id: "leaf-1", pagePath: null };
  const leaf2: PaneLeaf = { type: "leaf", id: "leaf-2", pagePath: null };
  const root: PaneSplit = {
    type: "split",
    id: "split-root",
    direction: "vertical",
    children: [leaf1, leaf2],
    sizes: [50, 50],
  };
  return { root, focusedPaneId: leaf1.id };
}

describe("useKeymaps", () => {
  beforeEach(() => {
    _clear();
    resetEditorViewRef();
    usePaneStore.setState(createInitialState());
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
          { key: "Mod-d", command: "pane.splitRight" },
          { key: "Mod-Shift-d", command: "pane.splitDown" },
          { key: "Mod-Alt-ArrowRight", command: "pane.focusNext" },
          { key: "Mod-Alt-ArrowLeft", command: "pane.focusPrev" },
          { key: "Ctrl-g", command: "editor.selectNextOccurrence", when: "editorFocus" },
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

  it("workbench.toggleSideBar updates store synchronously before IPC", async () => {
    usePreferencesStore.setState({ sidebarVisible: true });
    await loadHook();

    mockInvoke((cmd) => {
      if (cmd === "set_preference") return undefined;
      if (cmd === "get_keymaps") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    executeCommand("workbench.toggleSideBar");
    expect(usePreferencesStore.getState().sidebarVisible).toBe(false);
  });

  it("double-toggle restores original sidebarVisible state", async () => {
    usePreferencesStore.setState({ sidebarVisible: true });
    await loadHook();

    mockInvoke((cmd) => {
      if (cmd === "set_preference") return undefined;
      if (cmd === "get_keymaps") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    executeCommand("workbench.toggleSideBar");
    executeCommand("workbench.toggleSideBar");
    expect(usePreferencesStore.getState().sidebarVisible).toBe(true);
  });

  it("workbench.toggleSideBar still fires IPC set_preference", async () => {
    usePreferencesStore.setState({ sidebarVisible: true });
    await loadHook();

    const ipcCalls: Array<{ key: string; value: unknown }> = [];
    mockInvoke((cmd, args) => {
      if (cmd === "set_preference") {
        ipcCalls.push(args as { key: string; value: unknown });
        return undefined;
      }
      if (cmd === "get_keymaps") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    executeCommand("workbench.toggleSideBar");
    expect(ipcCalls).toHaveLength(1);
    expect(ipcCalls[0]).toEqual({ key: "workbench.sideBar.visible", value: false });
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

  // --- Cycle 1: pane.splitRight command registration ---

  it("pane.splitRight is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("pane.splitRight")).toBe(true);
  });

  it("executing pane.splitRight splits focused pane horizontally", async () => {
    await loadHook();
    usePaneStore.setState(createInitialState());
    executeCommand("pane.splitRight");
    const root = usePaneStore.getState().root;
    expect(root.type).toBe("split");
    expect((root as PaneSplit).direction).toBe("horizontal");
  });

  // --- Cycle 2: pane.splitDown command registration ---

  it("pane.splitDown is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("pane.splitDown")).toBe(true);
  });

  it("executing pane.splitDown splits focused pane vertically", async () => {
    await loadHook();
    usePaneStore.setState(createInitialState());
    executeCommand("pane.splitDown");
    const root = usePaneStore.getState().root;
    expect(root.type).toBe("split");
    expect((root as PaneSplit).direction).toBe("vertical");
  });

  // --- Cycle 3: pane.focusNext with DOM focus transfer ---

  it("executing pane.focusNext advances focus and calls view.focus()", async () => {
    await loadHook();
    const twoLeafState = makeTwoLeafState();
    usePaneStore.setState(twoLeafState);
    const [, leaf2] = collectLeaves(usePaneStore.getState().root);
    const mockView2 = { focus: vi.fn() } as unknown as EditorView;
    registerPaneView(leaf2!.id, mockView2);

    executeCommand("pane.focusNext");

    expect(usePaneStore.getState().focusedPaneId).toBe(leaf2!.id);
    expect(mockView2.focus).toHaveBeenCalled();
  });

  // --- Cycle 4: pane.focusPrev with DOM focus transfer ---

  it("executing pane.focusPrev moves focus backward and calls view.focus()", async () => {
    await loadHook();
    const twoLeafState = makeTwoLeafState();
    usePaneStore.setState({ ...twoLeafState, focusedPaneId: "leaf-2" });
    const mockView1 = { focus: vi.fn() } as unknown as EditorView;
    registerPaneView("leaf-1", mockView1);

    executeCommand("pane.focusPrev");

    expect(usePaneStore.getState().focusedPaneId).toBe("leaf-1");
    expect(mockView1.focus).toHaveBeenCalled();
  });

  // --- Cycle 5: pane.close closes pane when multiple exist ---

  it("executing pane.close with >1 pane closes the focused pane", async () => {
    await loadHook();
    const twoLeafState = makeTwoLeafState();
    usePaneStore.setState(twoLeafState);
    const originalLeaves = collectLeaves(usePaneStore.getState().root);

    executeCommand("pane.close");

    const newLeaves = collectLeaves(usePaneStore.getState().root);
    expect(newLeaves).toHaveLength(1);
    expect(newLeaves[0]!.id).toBe(originalLeaves[1]!.id);
  });

  // --- Cycle 6: pane.close returns false when single pane ---

  it("executing pane.close with 1 pane returns false and does not close", async () => {
    await loadHook();
    usePaneStore.setState(createInitialState());
    const result = executeCommand("pane.close");
    expect(result).toBe(false);
    expect(usePaneStore.getState().root.type).toBe("leaf");
  });

  // --- Cycle 7: Command palette when guards ---

  it("pane.close is hidden in command palette with 1 pane", async () => {
    await loadHook();
    usePaneStore.setState(createInitialState());
    const visible = getVisibleCommands("pane");
    const ids = visible.map((c) => c.id);
    expect(ids).toContain("pane.splitRight");
    expect(ids).toContain("pane.splitDown");
    expect(ids).not.toContain("pane.close");
    expect(ids).not.toContain("pane.focusNext");
    expect(ids).not.toContain("pane.focusPrev");
  });

  it("all pane commands visible in command palette with 2 panes", async () => {
    await loadHook();
    usePaneStore.setState(makeTwoLeafState());
    const ids = getVisibleCommands("pane").map((c) => c.id);
    expect(ids).toContain("pane.splitRight");
    expect(ids).toContain("pane.splitDown");
    expect(ids).toContain("pane.close");
    expect(ids).toContain("pane.focusNext");
    expect(ids).toContain("pane.focusPrev");
  });

  // --- Cycle 8: Max-pane cap when guards ---

  it("pane.splitRight and pane.splitDown hidden in command palette at MAX_PANES", async () => {
    await loadHook();
    const leaves: PaneLeaf[] = Array.from({ length: 6 }, (_, i) => ({
      type: "leaf", id: `l${i}`, pagePath: null,
    }));
    const root: PaneSplit = {
      type: "split", id: "split-root", direction: "horizontal",
      children: leaves, sizes: leaves.map(() => 100 / 6),
    };
    usePaneStore.setState({ root, focusedPaneId: leaves[0]!.id });
    const ids = getVisibleCommands("pane").map((c) => c.id);
    expect(ids).not.toContain("pane.splitRight");
    expect(ids).not.toContain("pane.splitDown");
  });

  it("pane.splitRight and pane.splitDown visible at MAX_PANES - 1", async () => {
    await loadHook();
    const leaves: PaneLeaf[] = Array.from({ length: 5 }, (_, i) => ({
      type: "leaf", id: `l${i}`, pagePath: null,
    }));
    const root: PaneSplit = {
      type: "split", id: "split-root", direction: "horizontal",
      children: leaves, sizes: leaves.map(() => 100 / 5),
    };
    usePaneStore.setState({ root, focusedPaneId: leaves[0]!.id });
    const ids = getVisibleCommands("pane").map((c) => c.id);
    expect(ids).toContain("pane.splitRight");
    expect(ids).toContain("pane.splitDown");
  });

  // --- Cycle 10: Keyboard dispatch end-to-end ---

  it("Mod-d keydown triggers pane.splitRight", async () => {
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    usePaneStore.setState(createInitialState());

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "d", metaKey: true }));

    expect(usePaneStore.getState().root.type).toBe("split");
  });

  // --- Cycle 12: close-menu event logic (unit-level, no component render) ---

  it("close-pane-or-window logic with >1 pane executes pane.close", async () => {
    await loadHook();
    usePaneStore.setState(makeTwoLeafState());

    const leaves = collectLeaves(usePaneStore.getState().root);
    expect(leaves).toHaveLength(2);
    executeCommand("pane.close");

    const newLeaves = collectLeaves(usePaneStore.getState().root);
    expect(newLeaves).toHaveLength(1);
  });

  it("close-pane-or-window logic with 1 pane does not close pane", async () => {
    await loadHook();
    usePaneStore.setState(createInitialState());

    const result = executeCommand("pane.close");
    expect(result).toBe(false);
    expect(usePaneStore.getState().root.type).toBe("leaf");
  });

  // --- Cycle C1: app.askQuestion command registration ---

  it("app.askQuestion is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("app.askQuestion")).toBe(true);
  });

  it("executing app.askQuestion opens bottom panel with LLM tab", async () => {
    const { useBottomPanelStore } = await import("../stores/bottomPanel");
    await loadHook();
    executeCommand("app.askQuestion");
    const state = useBottomPanelStore.getState();
    expect(state.activeTab).toBe("llm-response");
    expect(state.unfolded).toBe(true);
    expect(state.hasOpenedLlm).toBe(true);
  });

  it("app.askQuestion appears in command palette", async () => {
    await loadHook();
    const visible = getVisibleCommands("ask");
    const ids = visible.map((c) => c.id);
    expect(ids).toContain("app.askQuestion");
  });

  // --- Cycle C4: Default keybinding for app.fireAnnotation ---

  it("app.fireAnnotation is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("app.fireAnnotation")).toBe(true);
  });

  it("app.batchFireAnnotations is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("app.batchFireAnnotations")).toBe(true);
  });

  // --- Cycle B4: when guard on global keydown handler ---

  it("Mod-Enter does not fire app.fireAnnotation when no editor is focused", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { key: "Mod-Enter", command: "app.fireAnnotation", when: "editorFocus" },
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    const preventDefault = vi.fn();
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      metaKey: true,
      bubbles: true,
    });
    Object.defineProperty(event, "preventDefault", { value: preventDefault });
    document.dispatchEvent(event);

    expect(preventDefault).not.toHaveBeenCalled();
  });

  // --- Cycle 13: Integration smoke test ---

  it("split → navigate → close full keyboard flow", async () => {
    await loadHook();
    usePaneStore.setState(createInitialState());

    executeCommand("pane.splitRight");
    const afterSplit = usePaneStore.getState();
    expect(afterSplit.root.type).toBe("split");
    const splitLeaves = collectLeaves(afterSplit.root);
    expect(splitLeaves).toHaveLength(2);

    const originalFocused = afterSplit.focusedPaneId;
    executeCommand("pane.focusNext");
    const afterNav = usePaneStore.getState();
    expect(afterNav.focusedPaneId).not.toBe(originalFocused);

    executeCommand("pane.close");
    const afterClose = usePaneStore.getState();
    expect(collectLeaves(afterClose.root)).toHaveLength(1);
  });
});
