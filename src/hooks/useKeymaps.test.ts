import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { mockInvoke } from "../test/tauri-mock";
import {
  registerHandler,
  hasCommand,
  executeCommand,
  getAllCommands,
  getVisibleCommands,
  _clear,
} from "../lib/commandRegistry";
import { usePreferencesStore } from "../stores/preferences";
import { useWorkspaceStore } from "../stores/workspace";
import { usePaneStore, createInitialState, collectLeaves, type PaneSplit, type PaneLeaf, type PaneNode } from "../stores/panes";
import { usePaneHistoryStore } from "../stores/paneHistory";
import { registerPaneView, setFocusedPane, _resetForTesting as resetEditorViewRef } from "../lib/editorViewRef";
import { useBottomPanelStore, defaultTabMeta } from "../stores/bottomPanel";
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
    document.body.innerHTML = "";
    usePaneStore.setState(createInitialState());
    usePaneHistoryStore.setState({ stacks: new Map() });
    useBottomPanelStore.setState({ activeTab: "linked", unfolded: false, tabMeta: defaultTabMeta() });
    usePreferencesStore.setState({ annotationEnabled: true });
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
          { key: "Mod-g", command: "editor.findNext", when: "editorFocus" },
          { key: "Mod-Shift-g", command: "editor.findPrevious", when: "editorFocus" },
          { key: "Mod-1", command: "app.showEditorView" },
          { key: "Mod-2", command: "app.showMindmapView" },
          { key: "Mod-3", command: "app.showGraphView" },
          { key: "Mod-d", command: "pane.splitRight" },
          { key: "Mod-Shift-d", command: "pane.splitDown" },
          { key: "Mod-Alt-ArrowRight", command: "pane.focusNext" },
          { key: "Mod-Alt-ArrowLeft", command: "pane.focusPrev" },
          { key: "Mod-[", command: "pane.historyBack" },
          { key: "Mod-]", command: "pane.historyForward" },
          { key: "Mod-Shift-]", command: "pane.focusContentNext" },
          { key: "Mod-Shift-[", command: "pane.focusContentPrev" },
          { key: "Ctrl-g", command: "editor.selectNextOccurrence", when: "editorFocus" },
          { key: "Ctrl-`", command: "panel.toggleBottom" },
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  async function loadHook() {
    const { useKeymaps } = await import("./useKeymaps");
    const { useAppKeybindings } = await import("./useAppKeybindings");
    return renderHook(() => { useAppKeybindings(); return useKeymaps(); });
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

  it("executing app.showGraphView dispatches lit:set-view-mode with 'graph'", async () => {
    await loadHook();
    const listener = vi.fn();
    window.addEventListener("lit:set-view-mode", listener);
    executeCommand("app.showGraphView");
    window.removeEventListener("lit:set-view-mode", listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]![0] as CustomEvent).detail).toBe("graph");
  });

  it("Mod-3 keydown dispatches lit:set-view-mode with 'graph'", async () => {
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    const listener = vi.fn();
    window.addEventListener("lit:set-view-mode", listener);

    const event = new KeyboardEvent("keydown", {
      key: "3",
      ctrlKey: true,
    });
    document.dispatchEvent(event);

    window.removeEventListener("lit:set-view-mode", listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]![0] as CustomEvent).detail).toBe("graph");
  });

  it("editor.findNext is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("editor.findNext")).toBe(true);
  });

  it("editor.findPrevious is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("editor.findPrevious")).toBe(true);
  });

  it("app.showEditorView is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("app.showEditorView")).toBe(true);
  });

  it("app.showMindmapView is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("app.showMindmapView")).toBe(true);
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
      ctrlKey: true,
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

  it("executing pane.close on empty single pane is no-op", async () => {
    await loadHook();
    usePaneStore.setState(createInitialState());
    const before = usePaneStore.getState().root;
    executeCommand("pane.close");
    expect(usePaneStore.getState().root).toBe(before);
  });

  // --- Cycle 7: Command palette when guards ---

  it("pane.close is visible in command palette even with 1 pane", async () => {
    await loadHook();
    usePaneStore.setState(createInitialState());
    const visible = getVisibleCommands("pane");
    const ids = visible.map((c) => c.id);
    expect(ids).toContain("pane.splitRight");
    expect(ids).toContain("pane.splitDown");
    expect(ids).toContain("pane.close");
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

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true }));

    expect(usePaneStore.getState().root.type).toBe("split");
  });

  // --- Cycle 12: close-menu event logic (unit-level, no component render) ---

  it("close-pane logic with >1 pane executes pane.close", async () => {
    await loadHook();
    usePaneStore.setState(makeTwoLeafState());

    const leaves = collectLeaves(usePaneStore.getState().root);
    expect(leaves).toHaveLength(2);
    executeCommand("pane.close");

    const newLeaves = collectLeaves(usePaneStore.getState().root);
    expect(newLeaves).toHaveLength(1);
  });

  it("pane.close on single pane with content clears pagePath", async () => {
    await loadHook();
    const leaf = { type: "leaf" as const, id: "solo", pagePath: "notes/foo.md" };
    usePaneStore.setState({ root: leaf, focusedPaneId: "solo" });

    executeCommand("pane.close");
    const state = usePaneStore.getState();
    expect(state.root).toEqual({ type: "leaf", id: "solo", pagePath: null });
    expect(state.focusedPaneId).toBe("solo");
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

  // --- Ctrl vs Cmd distinction (Mac) ---

  it("Ctrl+D must not trigger Mod-d binding on Mac (pane.splitRight)", async () => {
    const { platform } = await import("../lib/keymapResolver");
    const originalIsMac = platform.isMac;
    platform.isMac = true;
    try {
      const { result } = await loadHook();
      await waitFor(() => expect(result.current.loading).toBe(false));
      usePaneStore.setState(createInitialState());

      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true }),
      );

      expect(usePaneStore.getState().root.type).toBe("leaf");
    } finally {
      platform.isMac = originalIsMac;
    }
  });

  // --- Ctrl+` toggle bottom panel (platform-aware) ---

  it("Ctrl+` on Mac triggers panel.toggleBottom", async () => {
    const { platform } = await import("../lib/keymapResolver");
    const originalIsMac = platform.isMac;
    platform.isMac = true;
    try {
      const { result } = await loadHook();
      await waitFor(() => expect(result.current.loading).toBe(false));

      const listener = vi.fn();
      window.addEventListener("lit:toggle-bottom-panel", listener);

      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "`", ctrlKey: true, bubbles: true }),
      );

      window.removeEventListener("lit:toggle-bottom-panel", listener);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      platform.isMac = originalIsMac;
    }
  });

  it("Cmd+` on Mac does NOT trigger panel.toggleBottom", async () => {
    const { platform } = await import("../lib/keymapResolver");
    const originalIsMac = platform.isMac;
    platform.isMac = true;
    try {
      const { result } = await loadHook();
      await waitFor(() => expect(result.current.loading).toBe(false));

      const listener = vi.fn();
      window.addEventListener("lit:toggle-bottom-panel", listener);

      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "`", metaKey: true, bubbles: true }),
      );

      window.removeEventListener("lit:toggle-bottom-panel", listener);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      platform.isMac = originalIsMac;
    }
  });

  it("Ctrl+` on non-Mac triggers panel.toggleBottom", async () => {
    const { platform } = await import("../lib/keymapResolver");
    const originalIsMac = platform.isMac;
    platform.isMac = false;
    try {
      const { result } = await loadHook();
      await waitFor(() => expect(result.current.loading).toBe(false));

      const listener = vi.fn();
      window.addEventListener("lit:toggle-bottom-panel", listener);

      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "`", ctrlKey: true, bubbles: true }),
      );

      window.removeEventListener("lit:toggle-bottom-panel", listener);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      platform.isMac = originalIsMac;
    }
  });

  // --- Negated when-clause (!editorFocus) ---

  it("binding with when: !editorFocus does NOT fire when editor is focused", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { key: "Mod-z", command: "lit.undoOperation", when: "!editorFocus" },
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const actionFn = vi.fn();
    registerHandler("lit.undoOperation", actionFn);

    const mockView = { focus: vi.fn() } as unknown as EditorView;
    registerPaneView("main", mockView);
    usePaneStore.setState({
      root: { type: "leaf", id: "main", pagePath: "test.md" },
      focusedPaneId: "main",
    });

    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    const preventDefault = vi.fn();
    const event = new KeyboardEvent("keydown", {
      key: "z",
      metaKey: true,
      bubbles: true,
    });
    Object.defineProperty(event, "preventDefault", { value: preventDefault });
    document.dispatchEvent(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(actionFn).not.toHaveBeenCalled();
  });

  it("binding with when: !editorFocus DOES fire when no editor is focused", async () => {
    resetEditorViewRef();
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { key: "Mod-z", command: "lit.undoOperation", when: "!editorFocus" },
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const actionFn = vi.fn();
    registerHandler("lit.undoOperation", actionFn);

    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(actionFn).toHaveBeenCalled();
  });

  // --- Shifted punctuation: Mod-Shift-: (issue #253) ---

  it("macOS Cmd+Shift+; (key=';') triggers Mod-Shift-: binding (app.insertAnnotation)", async () => {
    // On macOS, Cmd+Shift+; reports key=";" (unshifted) due to a platform quirk.
    // keyStringFromEvent must use w3c-keyname's keyName() to get the correct shifted key.
    const { platform } = await import("../lib/keymapResolver");
    const originalIsMac = platform.isMac;
    platform.isMac = true;

    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { key: "Mod-Shift-:", command: "app.insertAnnotation" },
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    try {
      const { result } = await loadHook();
      await waitFor(() => expect(result.current.loading).toBe(false));

      const listener = vi.fn();
      window.addEventListener("lit:open-annotation-builder", listener);

      // Simulate macOS Cmd+Shift+; — key is ";" (unshifted), keyCode is 186
      const event = new KeyboardEvent("keydown", {
        key: ";",
        keyCode: 186,
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      window.removeEventListener("lit:open-annotation-builder", listener);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      platform.isMac = originalIsMac;
    }
  });

  it("non-Mac Ctrl+Shift+: (key=':') triggers Mod-Shift-: binding (app.insertAnnotation)", async () => {
    // On non-Mac, the browser correctly reports key=":" when Shift+; is pressed.
    const { platform } = await import("../lib/keymapResolver");
    const originalIsMac = platform.isMac;
    platform.isMac = false;

    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { key: "Mod-Shift-:", command: "app.insertAnnotation" },
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    try {
      const { result } = await loadHook();
      await waitFor(() => expect(result.current.loading).toBe(false));

      const listener = vi.fn();
      window.addEventListener("lit:open-annotation-builder", listener);

      // Simulate non-Mac Ctrl+Shift+: — key is ":" (shifted), keyCode is 186
      const event = new KeyboardEvent("keydown", {
        key: ":",
        keyCode: 186,
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      window.removeEventListener("lit:open-annotation-builder", listener);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      platform.isMac = originalIsMac;
    }
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

  // --- pane.focusContentNext / pane.focusContentPrev ---

  it("pane.focusContentNext is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("pane.focusContentNext")).toBe(true);
  });

  it("pane.focusContentPrev is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("pane.focusContentPrev")).toBe(true);
  });

  it("pane.focusContentNext advances focus when focus is inside content pane", async () => {
    await loadHook();
    const twoLeafState = makeTwoLeafState();
    usePaneStore.setState(twoLeafState);
    const [leaf1, leaf2] = collectLeaves(usePaneStore.getState().root);

    // Register pane views with real DOM to make isFocusInsideContentPane() return true
    const container1 = document.createElement("div");
    const input1 = document.createElement("input");
    container1.appendChild(input1);
    document.body.appendChild(container1);
    const mockView1 = { dom: container1, focus: vi.fn() } as unknown as EditorView;
    registerPaneView(leaf1!.id, mockView1);

    const container2 = document.createElement("div");
    document.body.appendChild(container2);
    const mockView2 = { dom: container2, focus: vi.fn() } as unknown as EditorView;
    registerPaneView(leaf2!.id, mockView2);

    // Focus inside first pane's DOM so isFocusInsideContentPane() returns true
    input1.focus();

    executeCommand("pane.focusContentNext");

    expect(usePaneStore.getState().focusedPaneId).toBe(leaf2!.id);
    expect(mockView2.focus).toHaveBeenCalled();
  });

  it("pane.focusContentPrev retreats focus when focus is inside content pane", async () => {
    await loadHook();
    const twoLeafState = makeTwoLeafState();
    usePaneStore.setState({ ...twoLeafState, focusedPaneId: "leaf-2" });
    const [leaf1, leaf2] = collectLeaves(usePaneStore.getState().root);

    const container1 = document.createElement("div");
    document.body.appendChild(container1);
    const mockView1 = { dom: container1, focus: vi.fn() } as unknown as EditorView;
    registerPaneView(leaf1!.id, mockView1);

    const container2 = document.createElement("div");
    const input2 = document.createElement("input");
    container2.appendChild(input2);
    document.body.appendChild(container2);
    const mockView2 = { dom: container2, focus: vi.fn() } as unknown as EditorView;
    registerPaneView(leaf2!.id, mockView2);

    // Focus inside second pane
    input2.focus();

    executeCommand("pane.focusContentPrev");

    expect(usePaneStore.getState().focusedPaneId).toBe(leaf1!.id);
    expect(mockView1.focus).toHaveBeenCalled();
  });

  it("pane.focusContentNext does NOT advance when focus is outside content pane, but transfers DOM focus", async () => {
    await loadHook();
    const twoLeafState = makeTwoLeafState();
    usePaneStore.setState(twoLeafState);
    const [leaf1] = collectLeaves(usePaneStore.getState().root);

    // Put a sidebar button (not inside any pane)
    const sidebarButton = document.createElement("button");
    document.body.appendChild(sidebarButton);
    sidebarButton.focus();

    const container1 = document.createElement("div");
    document.body.appendChild(container1);
    const mockView1 = { dom: container1, focus: vi.fn() } as unknown as EditorView;
    registerPaneView(leaf1!.id, mockView1);

    executeCommand("pane.focusContentNext");

    // Should NOT have advanced — still on leaf-1
    expect(usePaneStore.getState().focusedPaneId).toBe(leaf1!.id);
    // But should have transferred DOM focus
    expect(mockView1.focus).toHaveBeenCalled();
  });

  it("pane.focusContentNext with single pane transfers DOM focus (returns to editor from sidebar)", async () => {
    await loadHook();
    usePaneStore.setState(createInitialState());
    const leaf = collectLeaves(usePaneStore.getState().root)[0]!;

    const sidebarButton = document.createElement("button");
    document.body.appendChild(sidebarButton);
    sidebarButton.focus();

    const container = document.createElement("div");
    document.body.appendChild(container);
    const mockView = { dom: container, focus: vi.fn() } as unknown as EditorView;
    registerPaneView(leaf.id, mockView);

    executeCommand("pane.focusContentNext");

    expect(mockView.focus).toHaveBeenCalled();
  });

  it("pane.focusContentNext appears in command palette even with single pane", async () => {
    await loadHook();
    usePaneStore.setState(createInitialState());
    const visible = getVisibleCommands("content");
    const ids = visible.map((c) => c.id);
    expect(ids).toContain("pane.focusContentNext");
    expect(ids).toContain("pane.focusContentPrev");
  });

  it("Mod-Shift-] keydown triggers pane.focusContentNext", async () => {
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    const twoLeafState = makeTwoLeafState();
    usePaneStore.setState(twoLeafState);
    const [leaf1, leaf2] = collectLeaves(usePaneStore.getState().root);

    const container1 = document.createElement("div");
    const input1 = document.createElement("input");
    container1.appendChild(input1);
    document.body.appendChild(container1);
    const mockView1 = { dom: container1, focus: vi.fn() } as unknown as EditorView;
    registerPaneView(leaf1!.id, mockView1);

    const container2 = document.createElement("div");
    document.body.appendChild(container2);
    const mockView2 = { dom: container2, focus: vi.fn() } as unknown as EditorView;
    registerPaneView(leaf2!.id, mockView2);

    input1.focus();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "]", ctrlKey: true, shiftKey: true, bubbles: true }),
    );

    expect(usePaneStore.getState().focusedPaneId).toBe(leaf2!.id);
  });

  it("pane.focusContentNext wraps around with three panes", async () => {
    await loadHook();
    const l1: PaneLeaf = { type: "leaf", id: "p1", pagePath: null };
    const l2: PaneLeaf = { type: "leaf", id: "p2", pagePath: null };
    const l3: PaneLeaf = { type: "leaf", id: "p3", pagePath: null };
    const root: PaneSplit = {
      type: "split", id: "s1", direction: "horizontal",
      children: [l1, l2, l3], sizes: [33, 34, 33],
    };
    usePaneStore.setState({ root, focusedPaneId: "p1" });

    // Register views with DOM containers
    const containers = ["p1", "p2", "p3"].map((id) => {
      const c = document.createElement("div");
      const input = document.createElement("input");
      c.appendChild(input);
      document.body.appendChild(c);
      const view = { dom: c, focus: vi.fn() } as unknown as EditorView;
      registerPaneView(id, view);
      return { id, container: c, input, view };
    });

    // Focus inside p1
    containers[0]!.input.focus();

    executeCommand("pane.focusContentNext");
    expect(usePaneStore.getState().focusedPaneId).toBe("p2");

    // Simulate focus moving to p2's DOM (as transferDomFocus would do)
    containers[1]!.input.focus();

    executeCommand("pane.focusContentNext");
    expect(usePaneStore.getState().focusedPaneId).toBe("p3");

    // Simulate focus in p3
    containers[2]!.input.focus();

    executeCommand("pane.focusContentNext");
    expect(usePaneStore.getState().focusedPaneId).toBe("p1");
  });

  it("pane.focusContentNext after focus leaves content pane returns without advancing", async () => {
    await loadHook();
    const twoLeafState = makeTwoLeafState();
    usePaneStore.setState(twoLeafState);
    const [leaf1, leaf2] = collectLeaves(usePaneStore.getState().root);

    const container1 = document.createElement("div");
    const input1 = document.createElement("input");
    container1.appendChild(input1);
    document.body.appendChild(container1);
    registerPaneView(leaf1!.id, { dom: container1, focus: vi.fn() } as unknown as EditorView);

    const container2 = document.createElement("div");
    document.body.appendChild(container2);
    registerPaneView(leaf2!.id, { dom: container2, focus: vi.fn() } as unknown as EditorView);

    // Start inside pane 1, advance to pane 2
    input1.focus();
    executeCommand("pane.focusContentNext");
    expect(usePaneStore.getState().focusedPaneId).toBe(leaf2!.id);

    // Now focus moves to sidebar (outside content panes)
    const sidebarButton = document.createElement("button");
    document.body.appendChild(sidebarButton);
    sidebarButton.focus();

    // Execute again — should NOT advance, should stay on leaf2
    executeCommand("pane.focusContentNext");
    expect(usePaneStore.getState().focusedPaneId).toBe(leaf2!.id);
  });

  it("pane.focusContentNext after splitRight works with new pane", async () => {
    await loadHook();
    usePaneStore.setState(createInitialState());
    const initialLeaf = collectLeaves(usePaneStore.getState().root)[0]!;

    // Register initial pane view
    const container1 = document.createElement("div");
    const input1 = document.createElement("input");
    container1.appendChild(input1);
    document.body.appendChild(container1);
    registerPaneView(initialLeaf.id, { dom: container1, focus: vi.fn() } as unknown as EditorView);

    // Split creates a new pane
    executeCommand("pane.splitRight");
    const leaves = collectLeaves(usePaneStore.getState().root);
    expect(leaves).toHaveLength(2);
    const newLeaf = leaves[1]!;

    // Register new pane view
    const container2 = document.createElement("div");
    document.body.appendChild(container2);
    const mockView2 = { dom: container2, focus: vi.fn() } as unknown as EditorView;
    registerPaneView(newLeaf.id, mockView2);

    // Focus is on new pane (splitPane focuses it), simulate its DOM
    const input2 = document.createElement("input");
    container2.appendChild(input2);
    input2.focus();

    // Content next should wrap to the first pane
    executeCommand("pane.focusContentNext");
    expect(usePaneStore.getState().focusedPaneId).toBe(initialLeaf.id);
  });

  it("fires a toggle command only once when two hook instances are mounted", async () => {
    const { useKeymaps } = await import("./useKeymaps");
    const { useAppKeybindings } = await import("./useAppKeybindings");
    const hook1 = renderHook(() => { useAppKeybindings(); return useKeymaps(); });
    const hook2 = renderHook(() => { useAppKeybindings(); return useKeymaps(); });
    await waitFor(() => expect(hook1.result.current.loading).toBe(false));
    await waitFor(() => expect(hook2.result.current.loading).toBe(false));

    const listener = vi.fn();
    window.addEventListener("lit:toggle-bottom-panel", listener);

    const event = new KeyboardEvent("keydown", {
      key: "`",
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    window.removeEventListener("lit:toggle-bottom-panel", listener);
    expect(listener).toHaveBeenCalledTimes(1);

    hook1.unmount();
    hook2.unmount();
  });

  // --- Shifted punctuation: Mod-Shift-> (sidebar.revealInFileTree) ---

  it("macOS Cmd+Shift+. (key='.') triggers Mod-Shift-> binding (sidebar.revealInFileTree)", async () => {
    const { platform } = await import("../lib/keymapResolver");
    const originalIsMac = platform.isMac;
    platform.isMac = true;

    const actionFn = vi.fn();
    registerHandler("sidebar.revealInFileTree", actionFn);

    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { key: "Mod-Shift->", command: "sidebar.revealInFileTree" },
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    try {
      const { result } = await loadHook();
      await waitFor(() => expect(result.current.loading).toBe(false));

      const event = new KeyboardEvent("keydown", {
        key: ".",
        keyCode: 190,
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(actionFn).toHaveBeenCalledTimes(1);
    } finally {
      platform.isMac = originalIsMac;
    }
  });

  it("app.toggleFrontmatter is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("app.toggleFrontmatter")).toBe(true);
  });

  it("executing app.toggleFrontmatter dispatches lit:toggle-frontmatter", async () => {
    await loadHook();
    const listener = vi.fn();
    window.addEventListener("lit:toggle-frontmatter", listener);
    executeCommand("app.toggleFrontmatter");
    window.removeEventListener("lit:toggle-frontmatter", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("app.toggleFrontmatter is visible in command palette in single-pane mode with active page", async () => {
    await loadHook();
    useWorkspaceStore.setState({ currentPagePath: "test.md" });
    usePaneStore.setState(createInitialState());
    const ids = getVisibleCommands("frontmatter").map((c) => c.id);
    expect(ids).toContain("app.toggleFrontmatter");
  });

  it("app.toggleFrontmatter is NOT visible in command palette in multi-pane mode", async () => {
    await loadHook();
    useWorkspaceStore.setState({ currentPagePath: "test.md" });
    usePaneStore.setState(makeTwoLeafState());
    const ids = getVisibleCommands("frontmatter").map((c) => c.id);
    expect(ids).not.toContain("app.toggleFrontmatter");
  });

  it("app.toggleFrontmatter is NOT visible in command palette when no page is open", async () => {
    await loadHook();
    useWorkspaceStore.setState({ currentPagePath: null });
    usePaneStore.setState(createInitialState());
    const ids = getVisibleCommands("frontmatter").map((c) => c.id);
    expect(ids).not.toContain("app.toggleFrontmatter");
  });

  it("pane.historyBack is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("pane.historyBack")).toBe(true);
  });

  it("pane.historyForward is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("pane.historyForward")).toBe(true);
  });

  it("Mod-[ keydown triggers pane.historyBack", async () => {
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    const leaf: PaneLeaf = { type: "leaf", id: "hist-leaf", pagePath: "b.md" };
    usePaneStore.setState({ root: leaf, focusedPaneId: "hist-leaf" });

    // Seed history: ["a.md", "b.md"] at index 1 => canGoBack is true
    usePaneHistoryStore.setState({
      stacks: new Map([["hist-leaf", { entries: ["a.md", "b.md"], index: 1 }]]),
    });

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "[", ctrlKey: true, bubbles: true }),
    );

    const stack = usePaneHistoryStore.getState().stacks.get("hist-leaf")!;
    expect(stack.index).toBe(0);
  });

  it("Mod-] keydown triggers pane.historyForward", async () => {
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    const leaf: PaneLeaf = { type: "leaf", id: "hist-leaf", pagePath: "a.md" };
    usePaneStore.setState({ root: leaf, focusedPaneId: "hist-leaf" });

    // Seed history: ["a.md", "b.md"] at index 0 => canGoForward is true
    usePaneHistoryStore.setState({
      stacks: new Map([["hist-leaf", { entries: ["a.md", "b.md"], index: 0 }]]),
    });

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "]", ctrlKey: true, bubbles: true }),
    );

    const stack = usePaneHistoryStore.getState().stacks.get("hist-leaf")!;
    expect(stack.index).toBe(1);
  });

  it("Mod-[ keydown does NOT trigger pane.historyBack when canGoBack is false", async () => {
    const { result } = await loadHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    const leaf: PaneLeaf = { type: "leaf", id: "hist-leaf", pagePath: "a.md" };
    usePaneStore.setState({ root: leaf, focusedPaneId: "hist-leaf" });

    // Seed history: ["a.md"] at index 0 => canGoBack is false
    usePaneHistoryStore.setState({
      stacks: new Map([["hist-leaf", { entries: ["a.md"], index: 0 }]]),
    });

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "[", ctrlKey: true, bubbles: true }),
    );

    const stack = usePaneHistoryStore.getState().stacks.get("hist-leaf")!;
    expect(stack.index).toBe(0);
    expect(usePaneStore.getState().root).toMatchObject({ pagePath: "a.md" });
  });

  it("pane.historyBack and pane.historyForward visible in command palette only when navigable", async () => {
    await loadHook();

    const leaf: PaneLeaf = { type: "leaf", id: "hist-leaf", pagePath: "a.md" };
    usePaneStore.setState({ root: leaf, focusedPaneId: "hist-leaf" });

    // No history seeded -- neither should be visible
    const visibleBefore = getVisibleCommands("history");
    const idsBefore = visibleBefore.map((c) => c.id);
    expect(idsBefore).not.toContain("pane.historyBack");
    expect(idsBefore).not.toContain("pane.historyForward");

    // Seed history: ["a.md", "b.md"] at index 1 => canGoBack true, canGoForward false
    usePaneHistoryStore.setState({
      stacks: new Map([["hist-leaf", { entries: ["a.md", "b.md"], index: 1 }]]),
    });

    const visibleAfter = getVisibleCommands("history");
    const idsAfter = visibleAfter.map((c) => c.id);
    expect(idsAfter).toContain("pane.historyBack");
    expect(idsAfter).not.toContain("pane.historyForward");
  });

  // --- Cycle A: app.toggleAllBlockAnnotations command registration ---

  it("app.toggleAllBlockAnnotations is registered after ensureCommandsRegistered", async () => {
    await loadHook();
    expect(hasCommand("app.toggleAllBlockAnnotations")).toBe(true);
  });

  it("hidden from the palette without an editor view", async () => {
    await loadHook();
    resetEditorViewRef();
    const visible = getVisibleCommands("block annotations");
    const ids = visible.map((c) => c.id);
    expect(ids).not.toContain("app.toggleAllBlockAnnotations");
  });

  it("hidden from the palette when annotationEnabled is false even with an editor view", async () => {
    await loadHook();
    const leaf: PaneLeaf = { type: "leaf", id: "main", pagePath: "test.md" };
    const mockView = {
      focus: vi.fn(),
      state: { field: () => undefined, selection: { main: { head: 0 } } },
    } as unknown as EditorView;
    registerPaneView("main", mockView);
    setFocusedPane("main");
    usePaneStore.setState({ root: leaf, focusedPaneId: "main" });
    usePreferencesStore.setState({ annotationEnabled: false });
    const visible = getVisibleCommands("all threads");
    const ids = visible.map((c) => c.id);
    expect(ids).not.toContain("app.toggleAllBlockAnnotations");
  });

  // Minimal doc interface matching isFoldAllTarget's needs: length + lineAt.
  // "line0\nline1\nline2" -> line starts at 0, 6, 12; length 17.
  function makeMockDoc() {
    const lines: Array<{ from: number; number: number }> = [
      { from: 0, number: 1 },
      { from: 6, number: 2 },
      { from: 12, number: 3 },
    ];
    return {
      length: 17,
      lineAt(pos: number) {
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i]!;
          if (pos >= line.from) return line;
        }
        return lines[0]!;
      },
    };
  }

  it("visible in the palette when the view has a fold-all-target thread", async () => {
    await loadHook();
    const leaf: PaneLeaf = { type: "leaf", id: "main", pagePath: "test.md" };
    // Multiline thread starting at a line boundary -> isFoldAllTarget true.
    const thread = {
      annotation_type: "thread",
      char_start: 6,
      char_end: 17,
    };
    const mockView = {
      focus: vi.fn(),
      state: {
        field: () => [thread],
        doc: makeMockDoc(),
        selection: { main: { head: 0 } },
      },
    } as unknown as EditorView;
    registerPaneView("main", mockView);
    setFocusedPane("main");
    usePaneStore.setState({ root: leaf, focusedPaneId: "main" });
    const visible = getVisibleCommands("all threads");
    const ids = visible.map((c) => c.id);
    expect(ids).toContain("app.toggleAllBlockAnnotations");
  });

  it("hidden from the palette when annotations exist but none is a fold-all target", async () => {
    await loadHook();
    const leaf: PaneLeaf = { type: "leaf", id: "main", pagePath: "test.md" };
    // Multiline note (wrong type) + single-line thread (not multiline) -> no target.
    const note = {
      annotation_type: "note",
      char_start: 6,
      char_end: 17,
    };
    const singleLineThread = {
      annotation_type: "thread",
      char_start: 0,
      char_end: 5,
    };
    const mockView = {
      focus: vi.fn(),
      state: {
        field: () => [note, singleLineThread],
        doc: makeMockDoc(),
        selection: { main: { head: 0 } },
      },
    } as unknown as EditorView;
    registerPaneView("main", mockView);
    setFocusedPane("main");
    usePaneStore.setState({ root: leaf, focusedPaneId: "main" });
    const visible = getVisibleCommands("all threads");
    const ids = visible.map((c) => c.id);
    expect(ids).not.toContain("app.toggleAllBlockAnnotations");
  });

  it("hidden from the palette when the view has no annotations", async () => {
    await loadHook();
    const leaf: PaneLeaf = { type: "leaf", id: "main", pagePath: "test.md" };
    const mockView = {
      focus: vi.fn(),
      state: {
        field: () => undefined,
        doc: makeMockDoc(),
        selection: { main: { head: 0 } },
      },
    } as unknown as EditorView;
    registerPaneView("main", mockView);
    setFocusedPane("main");
    usePaneStore.setState({ root: leaf, focusedPaneId: "main" });
    const visible = getVisibleCommands("all threads");
    const ids = visible.map((c) => c.id);
    expect(ids).not.toContain("app.toggleAllBlockAnnotations");
  });

  it("surfaces Mod-Shift-m as shortcut on the palette entry", async () => {
    await loadHook();
    const cmd = getAllCommands().find((c) => c.id === "app.toggleAllBlockAnnotations");
    expect(cmd?.shortcut).toBe("Mod-Shift-m");
  });

  it("executing the command calls toggleAllBlockAnnotationFolds with the focused view", async () => {
    const mod = await import("../editor/livePreview/annotationFoldAll");
    const spy = vi.spyOn(mod, "toggleAllBlockAnnotationFolds").mockReturnValue(true);
    await loadHook();
    const leaf: PaneLeaf = { type: "leaf", id: "main", pagePath: "test.md" };
    const mockView = {
      focus: vi.fn(),
      state: { field: () => undefined, selection: { main: { head: 0 } } },
    } as unknown as EditorView;
    registerPaneView("main", mockView);
    setFocusedPane("main");
    usePaneStore.setState({ root: leaf, focusedPaneId: "main" });
    executeCommand("app.toggleAllBlockAnnotations");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(mockView);
    spy.mockRestore();
  });
});
