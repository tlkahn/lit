import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { mockInvoke } from "../test/tauri-mock";
import { _clear, registerCommand } from "../lib/commandRegistry";
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

  it("!editorFocus bindings skip editable targets but fire on plain targets", async () => {
    const originalIsMac = platform.isMac;
    platform.isMac = false;
    try {
      mockInvoke((cmd) => {
        if (cmd === "get_keymaps") {
          return [{ key: "Mod-z", command: "test.undo", when: "!editorFocus" }];
        }
        throw new Error(`Unknown command: ${cmd}`);
      });
      const action = vi.fn();
      registerCommand({ id: "test.undo", label: "Test Undo", action });

      const { useAppKeybindings } = await import("./useAppKeybindings");
      renderHook(() => { useAppKeybindings(); });

      const pressCtrlZ = (target: HTMLElement) => {
        const event = new KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(event);
        return event;
      };

      // The binding still fires on non-editable targets (file tree, body, ...).
      const plain = document.createElement("div");
      document.body.appendChild(plain);
      await vi.waitFor(() => {
        pressCtrlZ(plain);
        expect(action).toHaveBeenCalled();
      });
      action.mockClear();

      // ...but must not hijack Cmd/Ctrl-Z while typing in a text input,
      // textarea, or contenteditable region (native undo must survive).
      const input = document.createElement("input");
      input.type = "text";
      document.body.appendChild(input);
      const inputEvent = pressCtrlZ(input);
      expect(action).not.toHaveBeenCalled();
      expect(inputEvent.defaultPrevented).toBe(false);

      const textarea = document.createElement("textarea");
      document.body.appendChild(textarea);
      expect(pressCtrlZ(textarea).defaultPrevented).toBe(false);

      const ce = document.createElement("div");
      ce.setAttribute("contenteditable", "true");
      document.body.appendChild(ce);
      expect(pressCtrlZ(ce).defaultPrevented).toBe(false);

      expect(action).not.toHaveBeenCalled();
    } finally {
      platform.isMac = originalIsMac;
    }
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
