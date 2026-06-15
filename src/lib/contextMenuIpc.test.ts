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

describe("showMindmapContextMenu", () => {
  it("calls invoke with correct command and args (hasExport true)", async () => {
    mockInvoke((cmd) => {
      if (cmd === "show_mindmap_context_menu") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });
    const { showMindmapContextMenu } = await import("./contextMenuIpc");
    await showMindmapContextMenu("node-123", true);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("show_mindmap_context_menu", {
      nodeId: "node-123",
      hasExport: true,
    });
  });

  it("passes hasExport false correctly", async () => {
    mockInvoke((cmd) => {
      if (cmd === "show_mindmap_context_menu") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });
    const { showMindmapContextMenu } = await import("./contextMenuIpc");
    await showMindmapContextMenu("node-456", false);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("show_mindmap_context_menu", {
      nodeId: "node-456",
      hasExport: false,
    });
  });
});

describe("useMindmapContextMenu", () => {
  beforeEach(() => {
    resetListenMock();
    mockListen();
  });

  it("fires onEdit callback with node_id on edit event", async () => {
    const { useMindmapContextMenu } = await import("./contextMenuIpc");
    const handlers = { onEdit: vi.fn(), onExportNetwork: vi.fn() };

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useMindmapContextMenu(handlers));

    emitMockEvent("context-menu://mindmap/edit", { node_id: "node-123" });

    expect(handlers.onEdit).toHaveBeenCalledWith("node-123");
    expect(handlers.onExportNetwork).not.toHaveBeenCalled();
  });

  it("fires onExportNetwork callback with node_id on export-network event", async () => {
    const { useMindmapContextMenu } = await import("./contextMenuIpc");
    const handlers = { onEdit: vi.fn(), onExportNetwork: vi.fn() };

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useMindmapContextMenu(handlers));

    emitMockEvent("context-menu://mindmap/export-network", { node_id: "node-456" });

    expect(handlers.onExportNetwork).toHaveBeenCalledWith("node-456");
    expect(handlers.onEdit).not.toHaveBeenCalled();
  });

  it("cleans up listeners on unmount", async () => {
    const { useMindmapContextMenu } = await import("./contextMenuIpc");
    const handlers = { onEdit: vi.fn(), onExportNetwork: vi.fn() };

    const { renderHook } = await import("@testing-library/react");
    const { unmount } = renderHook(() => useMindmapContextMenu(handlers));

    unmount();

    emitMockEvent("context-menu://mindmap/edit", { node_id: "node-123" });
    expect(handlers.onEdit).not.toHaveBeenCalled();
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

describe("showGraphContextMenu", () => {
  it("calls invoke with correct command and args", async () => {
    mockInvoke((cmd) => {
      if (cmd === "show_graph_context_menu") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });
    const { showGraphContextMenu } = await import("./contextMenuIpc");
    await showGraphContextMenu({
      nodeId: "node-1",
      nodeIds: ["node-1", "node-2"],
      selectionCount: 2,
      hasHeadings: false,
      hasExport: true,
      isShadow: false,
    });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("show_graph_context_menu", {
      nodeId: "node-1",
      nodeIds: ["node-1", "node-2"],
      selectionCount: 2,
      hasHeadings: false,
      hasExport: true,
      isShadow: false,
    });
  });

  it("passes isShadow=true to invoke", async () => {
    mockInvoke((cmd) => {
      if (cmd === "show_graph_context_menu") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });
    const { showGraphContextMenu } = await import("./contextMenuIpc");
    await showGraphContextMenu({
      nodeId: "bib:smith2024",
      nodeIds: ["bib:smith2024"],
      selectionCount: 0,
      hasHeadings: false,
      hasExport: false,
      isShadow: true,
    });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("show_graph_context_menu", expect.objectContaining({
      isShadow: true,
    }));
  });
});

describe("useGraphContextMenu", () => {
  beforeEach(() => {
    resetListenMock();
    mockListen();
  });

  it("fires onMergeRequest with docs after reading pages for all node_ids", async () => {
    const page1 = { meta: { title: "A" }, body: "body-a", raw_yaml: "" };
    const page2 = { meta: { title: "B" }, body: "body-b", raw_yaml: "" };
    mockInvoke((cmd, args) => {
      if (cmd === "read_page") {
        const rel = (args as Record<string, unknown>).relativePath as string;
        if (rel === "n1") return page1;
        if (rel === "n2") return page2;
      }
      return null;
    });

    const { useGraphContextMenu } = await import("./contextMenuIpc");
    const handlers = {
      onMergeRequest: vi.fn(),
      onSplitRequest: vi.fn(),
      onDeleteRequest: vi.fn(),
      onExportNetwork: vi.fn(),
      onFetchDetails: vi.fn(),
      onCreateNote: vi.fn(),
      getNodeLabel: vi.fn((id: string) => id),
    };

    const { renderHook, waitFor } = await import("@testing-library/react");
    renderHook(() => useGraphContextMenu(handlers));

    emitMockEvent("context-menu://graph/merge", { node_id: "n1", node_ids: ["n1", "n2"] });

    await waitFor(() => {
      expect(handlers.onMergeRequest).toHaveBeenCalledWith([page1, page2]);
    });
  });

  it("fires onSplitRequest with plan and nodeId after readPage and previewSplit", async () => {
    const page = {
      meta: { title: "Doc", frontmatter: { tag: "x" } },
      body: "## Heading\ncontent",
      raw_yaml: "",
    };
    const plan = { preamble: null, sections: [{ title: "Heading", body: "content" }] };
    mockInvoke((cmd) => {
      if (cmd === "read_page") return page;
      if (cmd === "preview_split") return plan;
      return null;
    });

    const { useGraphContextMenu } = await import("./contextMenuIpc");
    const handlers = {
      onMergeRequest: vi.fn(),
      onSplitRequest: vi.fn(),
      onDeleteRequest: vi.fn(),
      onExportNetwork: vi.fn(),
      onFetchDetails: vi.fn(),
      onCreateNote: vi.fn(),
      getNodeLabel: vi.fn((id: string) => id),
    };

    const { renderHook, waitFor } = await import("@testing-library/react");
    renderHook(() => useGraphContextMenu(handlers));

    emitMockEvent("context-menu://graph/split", { node_id: "node-42", node_ids: [] });

    await waitFor(() => {
      expect(handlers.onSplitRequest).toHaveBeenCalledWith(plan, "node-42");
    });
  });

  it("fires onDeleteRequest with nodeIds and labels", async () => {
    const { useGraphContextMenu } = await import("./contextMenuIpc");
    const handlers = {
      onMergeRequest: vi.fn(),
      onSplitRequest: vi.fn(),
      onDeleteRequest: vi.fn(),
      onExportNetwork: vi.fn(),
      onFetchDetails: vi.fn(),
      onCreateNote: vi.fn(),
      getNodeLabel: vi.fn((id: string) => (id === "n1" ? "Alpha" : "Beta")),
    };

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useGraphContextMenu(handlers));

    emitMockEvent("context-menu://graph/delete", { node_id: "n1", node_ids: ["n1", "n2"] });

    expect(handlers.onDeleteRequest).toHaveBeenCalledWith(["n1", "n2"], ["Alpha", "Beta"]);
    expect(handlers.getNodeLabel).toHaveBeenCalledWith("n1");
    expect(handlers.getNodeLabel).toHaveBeenCalledWith("n2");
  });

  it("fires onExportNetwork with nodeId on export event", async () => {
    const { useGraphContextMenu } = await import("./contextMenuIpc");
    const handlers = {
      onMergeRequest: vi.fn(),
      onSplitRequest: vi.fn(),
      onDeleteRequest: vi.fn(),
      onExportNetwork: vi.fn(),
      onFetchDetails: vi.fn(),
      onCreateNote: vi.fn(),
      getNodeLabel: vi.fn((id: string) => id),
    };

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useGraphContextMenu(handlers));

    emitMockEvent("context-menu://graph/export-network", { node_id: "node-99", node_ids: [] });

    expect(handlers.onExportNetwork).toHaveBeenCalledWith("node-99");
  });

  it("fires onFetchDetails with node_id on fetch-details event", async () => {
    const { useGraphContextMenu } = await import("./contextMenuIpc");
    const handlers = {
      onMergeRequest: vi.fn(),
      onSplitRequest: vi.fn(),
      onDeleteRequest: vi.fn(),
      onExportNetwork: vi.fn(),
      onFetchDetails: vi.fn(),
      onCreateNote: vi.fn(),
      getNodeLabel: vi.fn((id: string) => id),
    };

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useGraphContextMenu(handlers));

    emitMockEvent("context-menu://graph/fetch-details", { node_id: "bib:smith2024", node_ids: [] });

    expect(handlers.onFetchDetails).toHaveBeenCalledWith("bib:smith2024");
  });

  it("cleans up fetch-details listener on unmount", async () => {
    const { useGraphContextMenu } = await import("./contextMenuIpc");
    const handlers = {
      onMergeRequest: vi.fn(),
      onSplitRequest: vi.fn(),
      onDeleteRequest: vi.fn(),
      onExportNetwork: vi.fn(),
      onFetchDetails: vi.fn(),
      onCreateNote: vi.fn(),
      getNodeLabel: vi.fn((id: string) => id),
    };

    const { renderHook } = await import("@testing-library/react");
    const { unmount } = renderHook(() => useGraphContextMenu(handlers));

    unmount();

    emitMockEvent("context-menu://graph/fetch-details", { node_id: "bib:smith2024", node_ids: [] });
    expect(handlers.onFetchDetails).not.toHaveBeenCalled();
  });

  it("fires onCreateNote callback with node_id on create-note event", async () => {
    const { useGraphContextMenu } = await import("./contextMenuIpc");
    const handlers = {
      onMergeRequest: vi.fn(),
      onSplitRequest: vi.fn(),
      onDeleteRequest: vi.fn(),
      onExportNetwork: vi.fn(),
      onFetchDetails: vi.fn(),
      onCreateNote: vi.fn(),
      getNodeLabel: vi.fn((id: string) => id),
    };

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useGraphContextMenu(handlers));

    emitMockEvent("context-menu://graph/create-note", { node_id: "bib:jones2023", node_ids: [] });

    expect(handlers.onCreateNote).toHaveBeenCalledWith("bib:jones2023");
  });

  it("cleans up create-note listener on unmount", async () => {
    const { useGraphContextMenu } = await import("./contextMenuIpc");
    const handlers = {
      onMergeRequest: vi.fn(),
      onSplitRequest: vi.fn(),
      onDeleteRequest: vi.fn(),
      onExportNetwork: vi.fn(),
      onFetchDetails: vi.fn(),
      onCreateNote: vi.fn(),
      getNodeLabel: vi.fn((id: string) => id),
    };

    const { renderHook } = await import("@testing-library/react");
    const { unmount } = renderHook(() => useGraphContextMenu(handlers));

    unmount();

    emitMockEvent("context-menu://graph/create-note", { node_id: "bib:jones2023", node_ids: [] });
    expect(handlers.onCreateNote).not.toHaveBeenCalled();
  });

  it("cleans up listeners on unmount", async () => {
    const { useGraphContextMenu } = await import("./contextMenuIpc");
    const handlers = {
      onMergeRequest: vi.fn(),
      onSplitRequest: vi.fn(),
      onDeleteRequest: vi.fn(),
      onExportNetwork: vi.fn(),
      onFetchDetails: vi.fn(),
      onCreateNote: vi.fn(),
      getNodeLabel: vi.fn((id: string) => id),
    };

    const { renderHook } = await import("@testing-library/react");
    const { unmount } = renderHook(() => useGraphContextMenu(handlers));

    unmount();

    emitMockEvent("context-menu://graph/delete", { node_id: "n1", node_ids: ["n1"] });
    expect(handlers.onDeleteRequest).not.toHaveBeenCalled();
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

describe("showCardboxContextMenu", () => {
  it("calls invoke with correct args for ungrouped card", async () => {
    mockInvoke((cmd) => {
      if (cmd === "show_cardbox_context_menu") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });
    const { showCardboxContextMenu } = await import("./contextMenuIpc");
    await showCardboxContextMenu({
      cardUuid: "card-1",
      isGrouped: false,
      isGroupHeader: false,
      hasGroups: true,
    });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("show_cardbox_context_menu", {
      cardUuid: "card-1",
      isGrouped: false,
      isGroupHeader: false,
      hasGroups: true,
    });
  });

  it("calls invoke with correct args for grouped card", async () => {
    mockInvoke((cmd) => {
      if (cmd === "show_cardbox_context_menu") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });
    const { showCardboxContextMenu } = await import("./contextMenuIpc");
    await showCardboxContextMenu({
      cardUuid: "card-2",
      groupId: "group-1",
      isGrouped: true,
      isGroupHeader: false,
      hasGroups: true,
    });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("show_cardbox_context_menu", {
      cardUuid: "card-2",
      groupId: "group-1",
      isGrouped: true,
      isGroupHeader: false,
      hasGroups: true,
    });
  });

  it("calls invoke with correct args for group header", async () => {
    mockInvoke((cmd) => {
      if (cmd === "show_cardbox_context_menu") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });
    const { showCardboxContextMenu } = await import("./contextMenuIpc");
    await showCardboxContextMenu({
      groupId: "group-1",
      isGroupHeader: true,
      isGrouped: false,
      hasGroups: true,
    });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("show_cardbox_context_menu", {
      groupId: "group-1",
      isGroupHeader: true,
      isGrouped: false,
      hasGroups: true,
    });
  });
});

describe("useCardboxContextMenu", () => {
  beforeEach(() => {
    resetListenMock();
    mockListen();
  });

  function makeHandlers() {
    return {
      onNewGroup: vi.fn(),
      onAddToGroup: vi.fn(),
      onRemoveFromGroup: vi.fn(),
      onDissolveGroup: vi.fn(),
      onRenameGroup: vi.fn(),
    };
  }

  it("fires onNewGroup with card_uuid on new-group event", async () => {
    const { useCardboxContextMenu } = await import("./contextMenuIpc");
    const handlers = makeHandlers();

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useCardboxContextMenu(handlers));

    emitMockEvent("context-menu://cardbox/new-group", { card_uuid: "card-1", group_id: null });

    expect(handlers.onNewGroup).toHaveBeenCalledWith("card-1");
    expect(handlers.onAddToGroup).not.toHaveBeenCalled();
  });

  it("fires onAddToGroup with card_uuid on add-to-group event", async () => {
    const { useCardboxContextMenu } = await import("./contextMenuIpc");
    const handlers = makeHandlers();

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useCardboxContextMenu(handlers));

    emitMockEvent("context-menu://cardbox/add-to-group", { card_uuid: "card-2", group_id: null });

    expect(handlers.onAddToGroup).toHaveBeenCalledWith("card-2");
    expect(handlers.onNewGroup).not.toHaveBeenCalled();
  });

  it("fires onRemoveFromGroup with card_uuid and group_id on remove-from-group event", async () => {
    const { useCardboxContextMenu } = await import("./contextMenuIpc");
    const handlers = makeHandlers();

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useCardboxContextMenu(handlers));

    emitMockEvent("context-menu://cardbox/remove-from-group", { card_uuid: "card-3", group_id: "group-1" });

    expect(handlers.onRemoveFromGroup).toHaveBeenCalledWith("card-3", "group-1");
  });

  it("fires onDissolveGroup with group_id on dissolve-group event", async () => {
    const { useCardboxContextMenu } = await import("./contextMenuIpc");
    const handlers = makeHandlers();

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useCardboxContextMenu(handlers));

    emitMockEvent("context-menu://cardbox/dissolve-group", { card_uuid: null, group_id: "group-2" });

    expect(handlers.onDissolveGroup).toHaveBeenCalledWith("group-2");
  });

  it("fires onRenameGroup with group_id on rename-group event", async () => {
    const { useCardboxContextMenu } = await import("./contextMenuIpc");
    const handlers = makeHandlers();

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useCardboxContextMenu(handlers));

    emitMockEvent("context-menu://cardbox/rename-group", { card_uuid: null, group_id: "group-3" });

    expect(handlers.onRenameGroup).toHaveBeenCalledWith("group-3");
  });

  it("does not fire onNewGroup when card_uuid is null", async () => {
    const { useCardboxContextMenu } = await import("./contextMenuIpc");
    const handlers = makeHandlers();

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useCardboxContextMenu(handlers));

    emitMockEvent("context-menu://cardbox/new-group", { card_uuid: null, group_id: null });

    expect(handlers.onNewGroup).not.toHaveBeenCalled();
  });

  it("does not fire onRemoveFromGroup when group_id is null", async () => {
    const { useCardboxContextMenu } = await import("./contextMenuIpc");
    const handlers = makeHandlers();

    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useCardboxContextMenu(handlers));

    emitMockEvent("context-menu://cardbox/remove-from-group", { card_uuid: "card-1", group_id: null });

    expect(handlers.onRemoveFromGroup).not.toHaveBeenCalled();
  });

  it("cleans up listeners on unmount", async () => {
    const { useCardboxContextMenu } = await import("./contextMenuIpc");
    const handlers = makeHandlers();

    const { renderHook } = await import("@testing-library/react");
    const { unmount } = renderHook(() => useCardboxContextMenu(handlers));

    unmount();

    emitMockEvent("context-menu://cardbox/new-group", { card_uuid: "card-1", group_id: null });
    expect(handlers.onNewGroup).not.toHaveBeenCalled();
  });
});
