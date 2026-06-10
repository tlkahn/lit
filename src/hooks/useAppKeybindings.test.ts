import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { mockInvoke } from "../test/tauri-mock";
import { _clear } from "../lib/commandRegistry";
import { usePaneStore } from "../stores/panes";
import { _resetForTesting as resetEditorViewRef } from "../lib/editorViewRef";
import { useBottomPanelStore, defaultTabMeta } from "../stores/bottomPanel";
import { platform } from "../lib/keymapResolver";

describe("useAppKeybindings", () => {
  beforeEach(() => {
    _clear();
    resetEditorViewRef();
    document.body.innerHTML = "";
    useBottomPanelStore.setState({ activeTab: "linked", unfolded: false, tabMeta: defaultTabMeta() });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { key: "Mod-w", command: "pane.close" },
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  it("Ctrl-W on PDF-only pane clears pagePath (no useKeymaps mounted)", async () => {
    const leaf = { type: "leaf" as const, id: "pdf-pane", pagePath: "papers/test.pdf" };
    usePaneStore.setState({ root: leaf, focusedPaneId: "pdf-pane" });

    const { useAppKeybindings } = await import("./useAppKeybindings");
    renderHook(() => { useAppKeybindings(); });

    await vi.waitFor(() => {
      const event = new KeyboardEvent("keydown", {
        key: "w",
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);
      const state = usePaneStore.getState();
      expect(state.root).toEqual({ type: "leaf", id: "pdf-pane", pagePath: null });
    });
  });

  it("app keydown handler works independently of useKeymaps", async () => {
    const originalIsMac = platform.isMac;
    platform.isMac = false;
    try {
      const leaf = { type: "leaf" as const, id: "solo", pagePath: "doc.pdf" };
      usePaneStore.setState({ root: leaf, focusedPaneId: "solo" });

      const { useAppKeybindings } = await import("./useAppKeybindings");
      renderHook(() => { useAppKeybindings(); });

      await vi.waitFor(() => {
        const event = new KeyboardEvent("keydown", {
          key: "w",
          ctrlKey: true,
          bubbles: true,
        });
        document.dispatchEvent(event);
        expect(usePaneStore.getState().root).toEqual({ type: "leaf", id: "solo", pagePath: null });
      });
    } finally {
      platform.isMac = originalIsMac;
    }
  });
});
