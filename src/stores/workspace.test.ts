import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockInvoke, mockListen, emitMockEvent } from "../test/tauri-mock";
import { useWorkspaceStore, getRecentWorkspaces, addRecentWorkspace } from "./workspace";
import { usePaneStore, createInitialState, collectLeaves, stopLayoutSync } from "./panes";
import type { PaneLeaf, PaneSplit } from "./panes";
import { saveLayout, STALE_THRESHOLD_MS } from "../lib/paneLayout";
import { usePanePdfLinkStore } from "./panePdfLink";
import { act } from "@testing-library/react";

const samplePages = [
  {
    title: "Page A",
    relative_path: "Page A.md",
    frontmatter: {},
    created_at: 1000,
    modified_at: 2000,
    file_type: 'markdown' as const,
  },
  {
    title: "Page B",
    relative_path: "Page B.md",
    frontmatter: {},
    created_at: 1000,
    modified_at: 2000,
    file_type: 'markdown' as const,
  },
];

describe("WorkspaceStore", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspacePath: null,
      pages: [],
      currentPagePath: null,
      pendingTitleFocus: false,
      pendingSection: null,
      currentPageHeadings: [],
      isDirty: false,
      reloadTrigger: 0,
      viewStates: {},
      paneViewStates: {},
      graphReady: false,
      indexProgress: null,
      loading: false,
      error: null,
    });

    mockListen();

    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "open_workspace":
          return samplePages;
        case "list_pages":
          return samplePages;
        case "create_page":
          return {
            title: (args as Record<string, unknown>)?.name as string,
            relative_path: `${(args as Record<string, unknown>)?.name as string}.md`,
            frontmatter: {},
            created_at: 3000,
            modified_at: 3000,
            file_type: 'markdown',
          };
        case "rename_page":
          return `${(args as Record<string, unknown>)?.newName as string}.md`;
        case "delete_page":
          return null;
        case "trash_page":
          return {
            trash_name: `${(args as Record<string, unknown>)?.relativePath}.123.md`,
            original_path: (args as Record<string, unknown>)?.relativePath,
            deleted_at: 123,
          };
        case "restore_page":
          return "restored.md";
        case "purge_page":
          return null;
        case "list_trash":
          return [
            { trash_name: "a.123.md", original_path: "a.md", deleted_at: 123 },
            { trash_name: "b.456.md", original_path: "b.md", deleted_at: 456 },
          ];
        case "empty_trash":
          return null;
        case "ensure_graph_ready":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
  });

  it("openWorkspace sets path, populates pages, clears error", async () => {
    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/my/workspace");
    });

    const state = useWorkspaceStore.getState();
    expect(state.workspacePath).toBe("/my/workspace");
    expect(state.pages).toHaveLength(2);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("graphReady defaults to false", () => {
    expect(useWorkspaceStore.getState().graphReady).toBe(false);
  });

  it("indexProgress defaults to null", () => {
    expect(useWorkspaceStore.getState().indexProgress).toBeNull();
  });

  it("openWorkspace sets graphReady to true after ensureGraphReady resolves", async () => {
    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/my/workspace");
    });

    const state = useWorkspaceStore.getState();
    expect(state.graphReady).toBe(true);
  });

  it("openWorkspace updates indexProgress from events", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "open_workspace":
          return samplePages;
        case "ensure_graph_ready":
          emitMockEvent("lit:index-progress", {
            phase: "parsing",
            current: 2,
            total: 5,
          });
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/my/workspace");
    });

    const state = useWorkspaceStore.getState();
    expect(state.indexProgress).toEqual({
      phase: "parsing",
      current: 2,
      total: 5,
    });
  });

  it("openWorkspace with failed ensureGraphReady sets error and graphReady stays false", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "open_workspace":
          return samplePages;
        case "ensure_graph_ready":
          throw new Error("index failed");
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/my/workspace");
    });

    const state = useWorkspaceStore.getState();
    expect(state.graphReady).toBe(false);
    expect(state.error).toContain("index failed");
  });

  it("openWorkspace adds path to recent workspaces", async () => {
    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/my/workspace");
    });
    expect(getRecentWorkspaces()).toContain("/my/workspace");
  });

  it("selectPage sets currentPagePath", () => {
    act(() => {
      useWorkspaceStore.getState().selectPage("Page A.md");
    });
    expect(useWorkspaceStore.getState().currentPagePath).toBe("Page A.md");
  });

  it("createPage adds to pages list", async () => {
    await act(async () => {
      await useWorkspaceStore.getState().createPage("New Page");
    });

    const state = useWorkspaceStore.getState();
    expect(state.pages).toHaveLength(1);
    expect(state.pages[0]!.title).toBe("New Page");
  });

  it("createPage auto-selects the new page", async () => {
    await act(async () => {
      await useWorkspaceStore.getState().createPage("New Page");
    });

    expect(useWorkspaceStore.getState().currentPagePath).toBe("New Page.md");
  });

  it("createPage sets pendingTitleFocus", async () => {
    await act(async () => {
      await useWorkspaceStore.getState().createPage("New Page");
    });

    expect(useWorkspaceStore.getState().pendingTitleFocus).toBe(true);
  });

  it("clearPendingTitleFocus resets the flag", async () => {
    await act(async () => {
      await useWorkspaceStore.getState().createPage("New Page");
    });

    act(() => {
      useWorkspaceStore.getState().clearPendingTitleFocus();
    });

    expect(useWorkspaceStore.getState().pendingTitleFocus).toBe(false);
  });

  it("renamePage updates pages list and current selection", async () => {
    useWorkspaceStore.setState({
      pages: [...samplePages],
      currentPagePath: "Page A.md",
    });

    await act(async () => {
      await useWorkspaceStore.getState().renamePage("Page A.md", "Renamed");
    });

    const state = useWorkspaceStore.getState();
    expect(state.pages.find((p) => p.relative_path === "Renamed.md")).toBeTruthy();
    expect(state.pages.find((p) => p.relative_path === "Page A.md")).toBeFalsy();
    expect(state.currentPagePath).toBe("Renamed.md");
  });

  it("deletePage removes from pages list", async () => {
    useWorkspaceStore.setState({ pages: [...samplePages] });

    await act(async () => {
      await useWorkspaceStore.getState().deletePage("Page A.md");
    });

    const state = useWorkspaceStore.getState();
    expect(state.pages).toHaveLength(1);
    expect(state.pages[0]!.title).toBe("Page B");
  });

  it("deletePage clears selection if current page deleted", async () => {
    useWorkspaceStore.setState({
      pages: [...samplePages],
      currentPagePath: "Page A.md",
    });

    await act(async () => {
      await useWorkspaceStore.getState().deletePage("Page A.md");
    });

    expect(useWorkspaceStore.getState().currentPagePath).toBeNull();
  });

  it("initial currentPageHeadings is []", () => {
    expect(useWorkspaceStore.getState().currentPageHeadings).toEqual([]);
  });

  it("setCurrentPageHeadings updates state", () => {
    const headings = [
      { level: 1, text: "Title", line: 0, from: 0, to: 7 },
      { level: 2, text: "Sub", line: 3, from: 20, to: 26 },
    ];
    act(() => {
      useWorkspaceStore.getState().setCurrentPageHeadings(headings);
    });
    expect(useWorkspaceStore.getState().currentPageHeadings).toEqual(headings);
  });

  it("isDirty defaults to false", () => {
    expect(useWorkspaceStore.getState().isDirty).toBe(false);
  });

  it("setDirty(true) sets isDirty", () => {
    act(() => {
      useWorkspaceStore.getState().setDirty(true);
    });
    expect(useWorkspaceStore.getState().isDirty).toBe(true);
  });

  it("selectPage resets isDirty to false", () => {
    act(() => {
      useWorkspaceStore.getState().setDirty(true);
    });
    act(() => {
      useWorkspaceStore.getState().selectPage("Page A.md");
    });
    expect(useWorkspaceStore.getState().isDirty).toBe(false);
  });

  it("reloadTrigger defaults to 0", () => {
    expect(useWorkspaceStore.getState().reloadTrigger).toBe(0);
  });

  it("triggerReload increments reloadTrigger", () => {
    act(() => {
      useWorkspaceStore.getState().triggerReload();
    });
    expect(useWorkspaceStore.getState().reloadTrigger).toBe(1);
    act(() => {
      useWorkspaceStore.getState().triggerReload();
    });
    expect(useWorkspaceStore.getState().reloadTrigger).toBe(2);
  });

  it("selectPage resets reloadTrigger to 0", () => {
    act(() => {
      useWorkspaceStore.getState().triggerReload();
    });
    act(() => {
      useWorkspaceStore.getState().selectPage("Page A.md");
    });
    expect(useWorkspaceStore.getState().reloadTrigger).toBe(0);
  });

  it("selectPageAtLine sets pendingCursorLine and pendingCursorCol", () => {
    act(() => {
      useWorkspaceStore.getState().selectPageAtLine("Page A.md", 10, 7);
    });
    const state = useWorkspaceStore.getState();
    expect(state.currentPagePath).toBe("Page A.md");
    expect(state.pendingCursorLine).toBe(10);
    expect(state.pendingCursorCol).toBe(7);
    expect(state.pendingCursorFileAbsolute).toBe(false);
  });

  it("selectPageAtLine defaults pendingCursorCol to null when col omitted", () => {
    act(() => {
      useWorkspaceStore.getState().selectPageAtLine("Page A.md", 5);
    });
    const state = useWorkspaceStore.getState();
    expect(state.pendingCursorLine).toBe(5);
    expect(state.pendingCursorCol).toBeNull();
  });

  it("selectPageAtLine with fileAbsolute sets pendingCursorFileAbsolute", () => {
    act(() => {
      useWorkspaceStore.getState().selectPageAtLine("Page A.md", 16, 5, true);
    });
    const state = useWorkspaceStore.getState();
    expect(state.pendingCursorLine).toBe(16);
    expect(state.pendingCursorFileAbsolute).toBe(true);
  });

  it("selectPage clears pendingCursorFileAbsolute", () => {
    act(() => {
      useWorkspaceStore.getState().selectPageAtLine("Page A.md", 16, 5, true);
    });
    expect(useWorkspaceStore.getState().pendingCursorFileAbsolute).toBe(true);
    act(() => {
      useWorkspaceStore.getState().selectPage("Page B.md");
    });
    expect(useWorkspaceStore.getState().pendingCursorFileAbsolute).toBe(false);
  });

  it("pendingSection initializes as null", () => {
    expect(useWorkspaceStore.getState().pendingSection).toBeNull();
  });

  it("selectPage clears pendingSection", () => {
    act(() => {
      useWorkspaceStore.setState({ pendingSection: "Heading" });
    });
    act(() => {
      useWorkspaceStore.getState().selectPage("Page A.md");
    });
    expect(useWorkspaceStore.getState().pendingSection).toBeNull();
  });

  it("selectPage clears currentPageHeadings", () => {
    act(() => {
      useWorkspaceStore.getState().setCurrentPageHeadings([
        { level: 1, text: "Title", line: 0, from: 0, to: 7 },
      ]);
    });
    act(() => {
      useWorkspaceStore.getState().selectPage("Page A.md");
    });
    expect(useWorkspaceStore.getState().currentPageHeadings).toEqual([]);
  });

  it("viewStates defaults to {}", () => {
    expect(useWorkspaceStore.getState().viewStates).toEqual({});
  });

  it("saveViewState stores scrollTop and cursor", () => {
    act(() => {
      useWorkspaceStore.getState().saveViewState("Page A.md", 150, 42);
    });
    expect(useWorkspaceStore.getState().viewStates["Page A.md"]).toEqual({ scrollTop: 150, cursor: 42 });
  });

  it("saveViewState overwrites previous value", () => {
    act(() => {
      useWorkspaceStore.getState().saveViewState("Page A.md", 100, 10);
    });
    act(() => {
      useWorkspaceStore.getState().saveViewState("Page A.md", 250, 55);
    });
    expect(useWorkspaceStore.getState().viewStates["Page A.md"]).toEqual({ scrollTop: 250, cursor: 55 });
  });

  it("multiple pages stored independently", () => {
    act(() => {
      useWorkspaceStore.getState().saveViewState("Page A.md", 100, 10);
    });
    act(() => {
      useWorkspaceStore.getState().saveViewState("Page B.md", 200, 20);
    });
    const vs = useWorkspaceStore.getState().viewStates;
    expect(vs["Page A.md"]).toEqual({ scrollTop: 100, cursor: 10 });
    expect(vs["Page B.md"]).toEqual({ scrollTop: 200, cursor: 20 });
  });

  it("deletePage clears pagePath from panes referencing deleted file", async () => {
    useWorkspaceStore.setState({ pages: [...samplePages] });
    const left: PaneLeaf = { type: "leaf", id: "left", pagePath: "Page A.md" };
    const right: PaneLeaf = { type: "leaf", id: "right", pagePath: "Page B.md" };
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [left, right],
      sizes: [50, 50],
    };
    usePaneStore.setState({ root, focusedPaneId: "left" });

    await act(async () => {
      await useWorkspaceStore.getState().deletePage("Page A.md");
    });

    const paneRoot = usePaneStore.getState().root as PaneSplit;
    expect((paneRoot.children[0] as PaneLeaf).pagePath).toBeNull();
    expect((paneRoot.children[1] as PaneLeaf).pagePath).toBe("Page B.md");
  });

  it("deletePage clears viewState for deleted page", async () => {
    useWorkspaceStore.setState({ pages: [...samplePages] });
    act(() => {
      useWorkspaceStore.getState().saveViewState("Page A.md", 100, 10);
      useWorkspaceStore.getState().saveViewState("Page B.md", 200, 20);
    });

    await act(async () => {
      await useWorkspaceStore.getState().deletePage("Page A.md");
    });

    const vs = useWorkspaceStore.getState().viewStates;
    expect(vs["Page A.md"]).toBeUndefined();
    expect(vs["Page B.md"]).toEqual({ scrollTop: 200, cursor: 20 });
  });

  it("renamePage transfers viewState to new path", async () => {
    useWorkspaceStore.setState({
      pages: [...samplePages],
      currentPagePath: "Page A.md",
    });
    act(() => {
      useWorkspaceStore.getState().saveViewState("Page A.md", 150, 42);
    });

    await act(async () => {
      await useWorkspaceStore.getState().renamePage("Page A.md", "Renamed");
    });

    const vs = useWorkspaceStore.getState().viewStates;
    expect(vs["Renamed.md"]).toEqual({ scrollTop: 150, cursor: 42 });
    expect(vs["Page A.md"]).toBeUndefined();
  });

  it("renamePage with no prior viewState is a no-op for viewStates", async () => {
    useWorkspaceStore.setState({
      pages: [...samplePages],
      currentPagePath: "Page A.md",
    });

    await act(async () => {
      await useWorkspaceStore.getState().renamePage("Page A.md", "Renamed");
    });

    expect(useWorkspaceStore.getState().viewStates).toEqual({});
  });

  it("saveMindmapFoldState stores ids in viewStates", () => {
    act(() => {
      useWorkspaceStore.getState().saveMindmapFoldState("Page A.md", ["h-1", "h-3"]);
    });
    expect(useWorkspaceStore.getState().viewStates["Page A.md"]?.mindmapFoldedIds).toEqual(["h-1", "h-3"]);
  });

  it("saveMindmapFoldState preserves existing scrollTop and cursor", () => {
    act(() => {
      useWorkspaceStore.getState().saveViewState("Page A.md", 150, 42);
    });
    act(() => {
      useWorkspaceStore.getState().saveMindmapFoldState("Page A.md", ["h-2"]);
    });
    const vs = useWorkspaceStore.getState().viewStates["Page A.md"];
    expect(vs).toEqual({ scrollTop: 150, cursor: 42, mindmapFoldedIds: ["h-2"] });
  });

  it("saveViewState preserves existing mindmapFoldedIds", () => {
    act(() => {
      useWorkspaceStore.getState().saveMindmapFoldState("Page A.md", ["h-1"]);
    });
    act(() => {
      useWorkspaceStore.getState().saveViewState("Page A.md", 200, 50);
    });
    const vs = useWorkspaceStore.getState().viewStates["Page A.md"];
    expect(vs).toEqual({ scrollTop: 200, cursor: 50, mindmapFoldedIds: ["h-1"] });
  });

  it("paneViewStates defaults to {}", () => {
    expect(useWorkspaceStore.getState().paneViewStates).toEqual({});
  });

  it("savePaneViewState stores scrollTop and cursor", () => {
    act(() => {
      useWorkspaceStore.getState().savePaneViewState("pane-1", 100, 42);
    });
    expect(useWorkspaceStore.getState().paneViewStates["pane-1"]).toEqual({ scrollTop: 100, cursor: 42 });
  });

  it("multiple panes stored independently", () => {
    act(() => {
      useWorkspaceStore.getState().savePaneViewState("pane-1", 100, 10);
    });
    act(() => {
      useWorkspaceStore.getState().savePaneViewState("pane-2", 200, 20);
    });
    const pvs = useWorkspaceStore.getState().paneViewStates;
    expect(pvs["pane-1"]).toEqual({ scrollTop: 100, cursor: 10 });
    expect(pvs["pane-2"]).toEqual({ scrollTop: 200, cursor: 20 });
  });

  it("removePaneViewState removes the entry", () => {
    act(() => {
      useWorkspaceStore.getState().savePaneViewState("pane-1", 100, 42);
    });
    act(() => {
      useWorkspaceStore.getState().removePaneViewState("pane-1");
    });
    expect(useWorkspaceStore.getState().paneViewStates["pane-1"]).toBeUndefined();
  });

  it("savePaneMindmapFoldState stores ids in paneViewStates", () => {
    act(() => {
      useWorkspaceStore.getState().savePaneMindmapFoldState("pane-1", ["h-1", "h-3"]);
    });
    expect(useWorkspaceStore.getState().paneViewStates["pane-1"]?.mindmapFoldedIds).toEqual(["h-1", "h-3"]);
  });

  it("savePaneViewState preserves existing mindmapFoldedIds", () => {
    act(() => {
      useWorkspaceStore.getState().savePaneMindmapFoldState("pane-1", ["h-1"]);
    });
    act(() => {
      useWorkspaceStore.getState().savePaneViewState("pane-1", 200, 50);
    });
    const pvs = useWorkspaceStore.getState().paneViewStates["pane-1"];
    expect(pvs).toEqual({ scrollTop: 200, cursor: 50, mindmapFoldedIds: ["h-1"] });
  });

  it("savePaneMindmapFoldState preserves existing scrollTop and cursor", () => {
    act(() => {
      useWorkspaceStore.getState().savePaneViewState("pane-1", 150, 42);
    });
    act(() => {
      useWorkspaceStore.getState().savePaneMindmapFoldState("pane-1", ["h-2"]);
    });
    const pvs = useWorkspaceStore.getState().paneViewStates["pane-1"];
    expect(pvs).toEqual({ scrollTop: 150, cursor: 42, mindmapFoldedIds: ["h-2"] });
  });

  it("refreshPages re-fetches page list", async () => {
    useWorkspaceStore.setState({ workspacePath: "/workspace" });

    await act(async () => {
      await useWorkspaceStore.getState().refreshPages();
    });

    expect(useWorkspaceStore.getState().pages).toHaveLength(2);
  });

  it("trashItems defaults to []", () => {
    expect(useWorkspaceStore.getState().trashItems).toEqual([]);
  });

  it("loadTrash populates trashItems", async () => {
    await act(async () => {
      await useWorkspaceStore.getState().loadTrash();
    });

    expect(useWorkspaceStore.getState().trashItems).toHaveLength(2);
    expect(useWorkspaceStore.getState().trashItems[0]!.trash_name).toBe("a.123.md");
  });

  it("restorePage removes item from trashItems and refreshes pages", async () => {
    useWorkspaceStore.setState({
      workspacePath: "/workspace",
      trashItems: [
        { trash_name: "a.123.md", original_path: "a.md", deleted_at: 123 },
        { trash_name: "b.456.md", original_path: "b.md", deleted_at: 456 },
      ],
    });

    await act(async () => {
      await useWorkspaceStore.getState().restorePage("a.123.md");
    });

    const state = useWorkspaceStore.getState();
    expect(state.trashItems).toHaveLength(1);
    expect(state.trashItems[0]!.trash_name).toBe("b.456.md");
  });

  it("purgePage removes item from trashItems", async () => {
    useWorkspaceStore.setState({
      trashItems: [
        { trash_name: "a.123.md", original_path: "a.md", deleted_at: 123 },
      ],
    });

    await act(async () => {
      await useWorkspaceStore.getState().purgePage("a.123.md");
    });

    expect(useWorkspaceStore.getState().trashItems).toHaveLength(0);
  });

  it("emptyTrash clears trashItems", async () => {
    useWorkspaceStore.setState({
      trashItems: [
        { trash_name: "a.123.md", original_path: "a.md", deleted_at: 123 },
        { trash_name: "b.456.md", original_path: "b.md", deleted_at: 456 },
      ],
    });

    await act(async () => {
      await useWorkspaceStore.getState().emptyTrash();
    });

    expect(useWorkspaceStore.getState().trashItems).toHaveLength(0);
  });
});

describe("getRecentWorkspaces", () => {
  it("returns empty array when no data", () => {
    expect(getRecentWorkspaces()).toEqual([]);
  });

  it("migrates legacy lit-workspace-path", () => {
    localStorage.setItem("lit-workspace-path", "/old/path");
    const result = getRecentWorkspaces();
    expect(result).toEqual(["/old/path"]);
    expect(localStorage.getItem("lit-workspace-path")).toBeNull();
    expect(localStorage.getItem("lit-recent-workspaces")).toBe(JSON.stringify(["/old/path"]));
  });

  it("returns stored list", () => {
    localStorage.setItem("lit-recent-workspaces", JSON.stringify(["/a", "/b"]));
    expect(getRecentWorkspaces()).toEqual(["/a", "/b"]);
  });
});

describe("addRecentWorkspace", () => {
  it("deduplicates and prepends", () => {
    addRecentWorkspace("/a");
    addRecentWorkspace("/b");
    addRecentWorkspace("/a");
    expect(getRecentWorkspaces()).toEqual(["/a", "/b"]);
  });

  it("trims to max 10 entries", () => {
    for (let i = 0; i < 15; i++) {
      addRecentWorkspace(`/path/${i}`);
    }
    expect(getRecentWorkspaces()).toHaveLength(10);
    expect(getRecentWorkspaces()[0]).toBe("/path/14");
  });
});

// ---------------------------------------------------------------------------
// Layout Persistence — openWorkspace restore + cleanup
// ---------------------------------------------------------------------------

describe("Layout Persistence", () => {
  beforeEach(() => {
    stopLayoutSync();
    usePaneStore.setState(createInitialState());
    useWorkspaceStore.setState({
      workspacePath: null,
      pages: [],
      currentPagePath: null,
      pendingTitleFocus: false,
      pendingSection: null,
      currentPageHeadings: [],
      isDirty: false,
      reloadTrigger: 0,
      viewStates: {},
      paneViewStates: {},
      graphReady: false,
      indexProgress: null,
      loading: false,
      error: null,
    });

    mockListen();
    mockInvoke((cmd) => {
      switch (cmd) {
        case "open_workspace":
          return samplePages;
        case "ensure_graph_ready":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
  });

  afterEach(() => {
    stopLayoutSync();
  });

  it("restores stored pane layout when valid layout exists", async () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: "Page A.md" },
        { type: "leaf", id: "b", pagePath: "Page B.md" },
      ],
      sizes: [40, 60],
    };
    saveLayout("/my/workspace", root, "b", {});

    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/my/workspace");
    });

    const paneState = usePaneStore.getState();
    expect(paneState.root.type).toBe("split");
    expect((paneState.root as PaneSplit).sizes).toEqual([40, 60]);
    expect(paneState.focusedPaneId).toBe("b");
  });

  it("falls back to initial single-pane state when no stored layout", async () => {
    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/my/workspace");
    });

    const paneState = usePaneStore.getState();
    expect(paneState.root.type).toBe("leaf");
    expect((paneState.root as PaneLeaf).pagePath).toBeNull();
  });

  it("falls back to initial state when stored layout is corrupted", async () => {
    localStorage.setItem("lit-pane-layout-/my/workspace", "{{bad json");

    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/my/workspace");
    });

    const paneState = usePaneStore.getState();
    expect(paneState.root.type).toBe("leaf");
  });

  it("nulls pagePath for panes referencing deleted files", async () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: "Page A.md" },
        { type: "leaf", id: "b", pagePath: "deleted-file.md" },
      ],
      sizes: [50, 50],
    };
    saveLayout("/my/workspace", root, "a", {});

    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/my/workspace");
    });

    const leaves = collectLeaves(usePaneStore.getState().root);
    expect(leaves[0]!.pagePath).toBe("Page A.md");
    expect(leaves[1]!.pagePath).toBeNull();
  });

  it("validates focusedPaneId: falls back to first leaf when stored ID gone", async () => {
    const root: PaneLeaf = { type: "leaf", id: "only-leaf", pagePath: "Page A.md" };
    saveLayout("/my/workspace", root, "nonexistent-id", {});

    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/my/workspace");
    });

    expect(usePaneStore.getState().focusedPaneId).toBe("only-leaf");
  });

  it("restores paneViewStates for surviving panes", async () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: "Page A.md" },
        { type: "leaf", id: "b", pagePath: "Page B.md" },
      ],
      sizes: [50, 50],
    };
    const pvs = {
      a: { scrollTop: 100, cursor: 42 },
      b: { scrollTop: 200, cursor: 84 },
      gone: { scrollTop: 0, cursor: 0 },
    };
    saveLayout("/my/workspace", root, "a", pvs);

    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/my/workspace");
    });

    const ws = useWorkspaceStore.getState();
    expect(ws.paneViewStates["a"]).toEqual({ scrollTop: 100, cursor: 42 });
    expect(ws.paneViewStates["b"]).toEqual({ scrollTop: 200, cursor: 84 });
    expect(ws.paneViewStates["gone"]).toBeUndefined();
  });

  describe("pdfLinks restore", () => {
    beforeEach(() => {
      usePanePdfLinkStore.setState({ links: new Map() });
    });

    afterEach(() => {
      usePanePdfLinkStore.setState({ links: new Map() });
    });

    it("restores pdfLinks whose endpoints survive validation", async () => {
      const root: PaneSplit = {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "a", pagePath: "Page A.md" },
          { type: "leaf", id: "b", pagePath: "Page B.md" },
        ],
        sizes: [50, 50],
      };
      saveLayout("/my/workspace", root, "a", {}, [["a", "b"]]);

      await act(async () => {
        await useWorkspaceStore.getState().openWorkspace("/my/workspace");
      });

      expect(usePanePdfLinkStore.getState().getLinkedPane("a")).toBe("b");
      expect(usePanePdfLinkStore.getState().getLinkedPane("b")).toBe("a");
    });

    it("drops links whose endpoints are not live leaves after validation", async () => {
      const root: PaneLeaf = { type: "leaf", id: "a", pagePath: "Page A.md" };
      // "b" is not in the tree at all.
      saveLayout("/my/workspace", root, "a", {}, [["a", "b"]]);

      await act(async () => {
        await useWorkspaceStore.getState().openWorkspace("/my/workspace");
      });

      expect(usePanePdfLinkStore.getState().getLinkedPane("a")).toBeUndefined();
      expect(usePanePdfLinkStore.getState().getLinkedPane("b")).toBeUndefined();
    });

    it("clears links to empty when no stored layout exists", async () => {
      usePanePdfLinkStore.setState({ links: new Map([["x", "y"], ["y", "x"]]) });

      await act(async () => {
        await useWorkspaceStore.getState().openWorkspace("/my/workspace");
      });

      expect(usePanePdfLinkStore.getState().links.size).toBe(0);
    });
  });

  it("starts layout sync subscription after restore", async () => {
    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/my/workspace");
    });

    // Mutate pane store — if sync is active, localStorage should update
    usePaneStore.getState().setPanePage(
      usePaneStore.getState().focusedPaneId,
      "Page A.md",
    );
    const raw = localStorage.getItem("lit-pane-layout-/my/workspace");
    expect(raw).not.toBeNull();
  });

  it("stops previous sync when opening different workspace", async () => {
    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/workspace-1");
    });

    // Open a second workspace
    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/workspace-2");
    });

    // Mutate pane store — should only write to workspace-2, not workspace-1
    localStorage.removeItem("lit-pane-layout-/workspace-1");
    localStorage.removeItem("lit-pane-layout-/workspace-2");

    usePaneStore.getState().setPanePage(
      usePaneStore.getState().focusedPaneId,
      "Page A.md",
    );

    expect(localStorage.getItem("lit-pane-layout-/workspace-1")).toBeNull();
    expect(localStorage.getItem("lit-pane-layout-/workspace-2")).not.toBeNull();
  });

  it("removes stale layout entries >30 days", async () => {
    const staleTime = Date.now() - STALE_THRESHOLD_MS - 1;
    localStorage.setItem(
      "lit-pane-layout-/old-workspace",
      JSON.stringify({
        root: { type: "leaf", id: "x", pagePath: null },
        focusedPaneId: "x",
        paneViewStates: {},
        savedAt: staleTime,
      }),
    );

    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/my/workspace");
    });

    expect(localStorage.getItem("lit-pane-layout-/old-workspace")).toBeNull();
  });

  it("keeps fresh layout entries for other workspaces", async () => {
    const freshLayout = JSON.stringify({
      root: { type: "leaf", id: "y", pagePath: null },
      focusedPaneId: "y",
      paneViewStates: {},
      savedAt: Date.now(),
    });
    localStorage.setItem("lit-pane-layout-/other-workspace", freshLayout);

    await act(async () => {
      await useWorkspaceStore.getState().openWorkspace("/my/workspace");
    });

    expect(localStorage.getItem("lit-pane-layout-/other-workspace")).not.toBeNull();
  });
});
