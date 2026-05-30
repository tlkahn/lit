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

describe("showSidebarContextMenu", () => {
  it("calls invoke with correct command and args", async () => {
    mockInvoke((cmd) => {
      if (cmd === "show_sidebar_context_menu") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });
    const { showSidebarContextMenu } = await import("./contextMenuIpc");
    await showSidebarContextMenu("notes.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("show_sidebar_context_menu", {
      relativePath: "notes.md",
    });
  });
});

describe("useSidebarContextMenu", () => {
  beforeEach(() => {
    resetListenMock();
    mockListen();
  });

  it("fires onRename callback with relative_path on rename event", async () => {
    const { useSidebarContextMenu } = await import("./contextMenuIpc");
    const handlers = {
      onRename: vi.fn(),
      onExternalEditor: vi.fn(),
      onExportNetwork: vi.fn(),
      onTrash: vi.fn(),
    };

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useSidebarContextMenu(handlers));

    emitMockEvent("context-menu://sidebar/rename", { relative_path: "notes.md" });

    expect(handlers.onRename).toHaveBeenCalledWith("notes.md");
    expect(handlers.onExternalEditor).not.toHaveBeenCalled();
    expect(handlers.onExportNetwork).not.toHaveBeenCalled();
    expect(handlers.onTrash).not.toHaveBeenCalled();
  });

  it("fires onExternalEditor callback on external-editor event", async () => {
    const { useSidebarContextMenu } = await import("./contextMenuIpc");
    const handlers = {
      onRename: vi.fn(),
      onExternalEditor: vi.fn(),
      onExportNetwork: vi.fn(),
      onTrash: vi.fn(),
    };

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useSidebarContextMenu(handlers));

    emitMockEvent("context-menu://sidebar/external-editor", { relative_path: "docs/readme.md" });

    expect(handlers.onExternalEditor).toHaveBeenCalledWith("docs/readme.md");
    expect(handlers.onRename).not.toHaveBeenCalled();
  });

  it("fires onExportNetwork callback on export-network event", async () => {
    const { useSidebarContextMenu } = await import("./contextMenuIpc");
    const handlers = {
      onRename: vi.fn(),
      onExternalEditor: vi.fn(),
      onExportNetwork: vi.fn(),
      onTrash: vi.fn(),
    };

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useSidebarContextMenu(handlers));

    emitMockEvent("context-menu://sidebar/export-network", { relative_path: "graph.md" });

    expect(handlers.onExportNetwork).toHaveBeenCalledWith("graph.md");
    expect(handlers.onTrash).not.toHaveBeenCalled();
  });

  it("fires onTrash callback on trash event", async () => {
    const { useSidebarContextMenu } = await import("./contextMenuIpc");
    const handlers = {
      onRename: vi.fn(),
      onExternalEditor: vi.fn(),
      onExportNetwork: vi.fn(),
      onTrash: vi.fn(),
    };

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useSidebarContextMenu(handlers));

    emitMockEvent("context-menu://sidebar/trash", { relative_path: "old.md" });

    expect(handlers.onTrash).toHaveBeenCalledWith("old.md");
    expect(handlers.onRename).not.toHaveBeenCalled();
  });

  it("cleans up listeners on unmount", async () => {
    const { useSidebarContextMenu } = await import("./contextMenuIpc");
    const handlers = {
      onRename: vi.fn(),
      onExternalEditor: vi.fn(),
      onExportNetwork: vi.fn(),
      onTrash: vi.fn(),
    };

    const { renderHook } = await import("@testing-library/react");
    const { unmount } = renderHook(() => useSidebarContextMenu(handlers));

    unmount();

    emitMockEvent("context-menu://sidebar/rename", { relative_path: "notes.md" });
    expect(handlers.onRename).not.toHaveBeenCalled();
  });
});
