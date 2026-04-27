import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke, mockListen, emitMockEvent } from "../test/tauri-mock";
import { useWorkspaceStore, getRecentWorkspaces, addRecentWorkspace } from "./workspace";
import { act } from "@testing-library/react";

const samplePages = [
  {
    title: "Page A",
    relative_path: "Page A.md",
    frontmatter: {},
    created_at: 1000,
    modified_at: 2000,
  },
  {
    title: "Page B",
    relative_path: "Page B.md",
    frontmatter: {},
    created_at: 1000,
    modified_at: 2000,
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
          };
        case "rename_page":
          return `${(args as Record<string, unknown>)?.newName as string}.md`;
        case "delete_page":
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
  });

  it("selectPageAtLine defaults pendingCursorCol to null when col omitted", () => {
    act(() => {
      useWorkspaceStore.getState().selectPageAtLine("Page A.md", 5);
    });
    const state = useWorkspaceStore.getState();
    expect(state.pendingCursorLine).toBe(5);
    expect(state.pendingCursorCol).toBeNull();
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

  it("refreshPages re-fetches page list", async () => {
    useWorkspaceStore.setState({ workspacePath: "/workspace" });

    await act(async () => {
      await useWorkspaceStore.getState().refreshPages();
    });

    expect(useWorkspaceStore.getState().pages).toHaveLength(2);
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
