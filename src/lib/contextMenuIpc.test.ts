import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockInvoke, mockListen, emitMockEvent, resetListenMock } from "../test/tauri-mock";

describe("contextMenuIpc", () => {
  beforeEach(() => {
    mockInvoke((cmd) => {
      if (cmd === "show_trash_context_menu") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  describe("showTrashContextMenu", () => {
    it("calls invoke with correct command and args", async () => {
      const { showTrashContextMenu } = await import("./contextMenuIpc");
      await showTrashContextMenu("file.123.md");
      const { invoke } = await import("@tauri-apps/api/core");
      expect(invoke).toHaveBeenCalledWith("show_trash_context_menu", {
        trashName: "file.123.md",
      });
    });
  });

  describe("useTrashContextMenu", () => {
    beforeEach(() => {
      resetListenMock();
      mockListen();
    });

    it("fires onRestore callback with trash_name on restore event", async () => {
      const { useTrashContextMenu } = await import("./contextMenuIpc");
      const onRestore = vi.fn();
      const onPurge = vi.fn();

      const { renderHook } = await import("@testing-library/react");
      renderHook(() => useTrashContextMenu({ onRestore, onPurge }));

      emitMockEvent("context-menu://trash/restore", { trash_name: "a.123.md" });

      expect(onRestore).toHaveBeenCalledWith("a.123.md");
      expect(onPurge).not.toHaveBeenCalled();
    });

    it("fires onPurge callback with trash_name on purge event", async () => {
      const { useTrashContextMenu } = await import("./contextMenuIpc");
      const onRestore = vi.fn();
      const onPurge = vi.fn();

      const { renderHook } = await import("@testing-library/react");
      renderHook(() => useTrashContextMenu({ onRestore, onPurge }));

      emitMockEvent("context-menu://trash/purge", { trash_name: "b.456.md" });

      expect(onPurge).toHaveBeenCalledWith("b.456.md");
      expect(onRestore).not.toHaveBeenCalled();
    });

    it("cleans up listeners on unmount", async () => {
      const { useTrashContextMenu } = await import("./contextMenuIpc");
      const onRestore = vi.fn();
      const onPurge = vi.fn();

      const { renderHook } = await import("@testing-library/react");
      const { unmount } = renderHook(() =>
        useTrashContextMenu({ onRestore, onPurge }),
      );

      unmount();

      emitMockEvent("context-menu://trash/restore", { trash_name: "a.123.md" });
      expect(onRestore).not.toHaveBeenCalled();
    });
  });
});
