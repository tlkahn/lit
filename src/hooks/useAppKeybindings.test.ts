import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { mockInvoke } from "../test/tauri-mock";
import { _clear, registerHandler } from "../lib/commandRegistry";
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

  it("command returning false does NOT consume the event (e.g. pdf.zoomReset with no PDF pane)", async () => {
    const actionSpy = vi.fn(() => false as const);
    // Register with test.* name so ensureCommandsRegistered won't overwrite
    registerHandler("test.returnsFalse", actionSpy);
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [{ key: "Mod-0", command: "test.returnsFalse" }];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { useAppKeybindings } = await import("./useAppKeybindings");
    renderHook(() => { useAppKeybindings(); });

    // Wait for keymaps to load by verifying the command fires
    await vi.waitFor(() => {
      const event = new KeyboardEvent("keydown", {
        key: "0",
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);
      expect(actionSpy).toHaveBeenCalled();
    });

    // Now dispatch again and check that the event is NOT consumed
    actionSpy.mockClear();
    const event = new KeyboardEvent("keydown", {
      key: "0",
      ctrlKey: true,
      bubbles: true,
    });
    const pdSpy = vi.spyOn(event, "preventDefault");
    const sipSpy = vi.spyOn(event, "stopImmediatePropagation");
    document.dispatchEvent(event);
    expect(actionSpy).toHaveBeenCalled();
    expect(pdSpy).not.toHaveBeenCalled();
    expect(sipSpy).not.toHaveBeenCalled();
  });

  it("command returning void DOES consume the event (e.g. pdf.zoomReset with active PDF)", async () => {
    const actionSpy = vi.fn(() => { /* returns undefined */ });
    registerHandler("test.returnsVoid", actionSpy);
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [{ key: "Mod-0", command: "test.returnsVoid" }];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { useAppKeybindings } = await import("./useAppKeybindings");
    renderHook(() => { useAppKeybindings(); });

    // Wait for keymaps to load by verifying the command fires
    await vi.waitFor(() => {
      const event = new KeyboardEvent("keydown", {
        key: "0",
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);
      expect(actionSpy).toHaveBeenCalled();
    });

    // Now dispatch again and check that the event IS consumed
    actionSpy.mockClear();
    const event = new KeyboardEvent("keydown", {
      key: "0",
      ctrlKey: true,
      bubbles: true,
    });
    const pdSpy = vi.spyOn(event, "preventDefault");
    const sipSpy = vi.spyOn(event, "stopImmediatePropagation");
    document.dispatchEvent(event);
    expect(actionSpy).toHaveBeenCalled();
    expect(pdSpy).toHaveBeenCalled();
    expect(sipSpy).toHaveBeenCalled();
  });

  it("existing command returning undefined still consumes the event", async () => {
    const actionSpy = vi.fn(() => {});
    registerHandler("test.noop", actionSpy);
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [{ key: "Mod-t", command: "test.noop" }];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { useAppKeybindings } = await import("./useAppKeybindings");
    renderHook(() => { useAppKeybindings(); });

    // Wait for keymaps to load by verifying the command fires
    await vi.waitFor(() => {
      const event = new KeyboardEvent("keydown", {
        key: "t",
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);
      expect(actionSpy).toHaveBeenCalled();
    });

    // Now dispatch again and check that the event IS consumed
    actionSpy.mockClear();
    const event = new KeyboardEvent("keydown", {
      key: "t",
      ctrlKey: true,
      bubbles: true,
    });
    const pdSpy = vi.spyOn(event, "preventDefault");
    const sipSpy = vi.spyOn(event, "stopImmediatePropagation");
    document.dispatchEvent(event);
    expect(actionSpy).toHaveBeenCalled();
    expect(pdSpy).toHaveBeenCalled();
    expect(sipSpy).toHaveBeenCalled();
  });
});
