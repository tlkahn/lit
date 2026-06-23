import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PaneNode } from "../../stores/panes";
import { _clear, hasCommand, executeCommand, getVisibleCommands } from "../commandRegistry";

// --- pane store mock -------------------------------------------------------
const mockPaneState = vi.hoisted(() => {
  const state: {
    root: { type: string; id: string; [k: string]: unknown };
    focusedPaneId: string;
    splitPane: ReturnType<typeof vi.fn>;
    setPanePage: ReturnType<typeof vi.fn>;
    focusPane: ReturnType<typeof vi.fn>;
  } = {
    root: {
      type: "leaf" as const,
      id: "src-pane",
      pagePath: "paper.md" as string | null,
    } as PaneNode,
    focusedPaneId: "src-pane",
    splitPane: vi.fn((_paneId: string, _direction: string): string | null => {
      // splitPane returns the new leaf ID and mutates focusedPaneId.
      state.focusedPaneId = "new-pane";
      return "new-pane";
    }),
    setPanePage: vi.fn(),
    focusPane: vi.fn(),
  };
  return state;
});

vi.mock("../../stores/panes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stores/panes")>();
  return {
    ...actual,
    usePaneStore: Object.assign(
      (selector: (s: Record<string, unknown>) => unknown) => selector(mockPaneState),
      { getState: () => mockPaneState },
    ),
  };
});

// --- panePdfLink store mock ------------------------------------------------
const mockLinkState = vi.hoisted(() => ({
  linkPanes: vi.fn(),
  toggleSync: vi.fn(),
  syncEnabled: true,
  setPendingPdfSync: vi.fn(),
  setPendingEditorSync: vi.fn(),
  currentPage: new Map<string, number>(),
}));

vi.mock("../../stores/panePdfLink", () => ({
  usePanePdfLinkStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockLinkState),
    { getState: () => mockLinkState },
  ),
}));

// --- status message store mock ---------------------------------------------
const mockStatusState = vi.hoisted(() => ({
  show: vi.fn(),
}));

vi.mock("../../stores/statusMessage", () => ({
  useStatusMessageStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockStatusState),
    { getState: () => mockStatusState },
  ),
}));

// --- ipc mock --------------------------------------------------------------
const mockFindCompanionFile = vi.hoisted(() => vi.fn());

vi.mock("../ipc", () => ({
  findCompanionFile: mockFindCompanionFile,
}));

// --- editorViewRef mock ----------------------------------------------------
const mockGetPaneView = vi.hoisted(() => vi.fn());

vi.mock("../editorViewRef", () => ({
  getPaneView: mockGetPaneView,
}));

// --- pdfPaneRef mock -------------------------------------------------------
const mockGetPdfCurrentPage = vi.hoisted(() => vi.fn());
const mockGetPdfGoToPage = vi.hoisted(() => vi.fn());
const mockMarkForwardSync = vi.hoisted(() => vi.fn());
const mockClearForwardSync = vi.hoisted(() => vi.fn());

vi.mock("../pdfPaneRef", () => ({
  getPdfCurrentPage: mockGetPdfCurrentPage,
  getPdfGoToPage: mockGetPdfGoToPage,
  markForwardSync: mockMarkForwardSync,
  clearForwardSync: mockClearForwardSync,
}));

// --- pageMarkers mock ------------------------------------------------------
const mockGetCachedPageMarkers = vi.hoisted(() => vi.fn());
const mockPageForOffset = vi.hoisted(() => vi.fn());

vi.mock("../pageMarkers", () => ({
  getCachedPageMarkers: mockGetCachedPageMarkers,
  pageForOffset: mockPageForOffset,
}));

// --- reverseSync mock ------------------------------------------------------
const mockDispatchReverseSync = vi.hoisted(() => vi.fn());

vi.mock("../reverseSync", () => ({
  dispatchReverseSync: mockDispatchReverseSync,
}));

// --- forwardSync mock ------------------------------------------------------
vi.mock("../forwardSync", () => ({
  FORWARD_SYNC_GUARD_MS: 2000,
}));

import { initCompanionCommands, selectCompanionTarget, resolveEditorPageIndex, resolvePdfPage } from "./companion";
import type { PaneLeaf } from "../../stores/panes";

function leaf(id: string, pagePath: string | null = null): PaneLeaf {
  return { type: "leaf", id, pagePath };
}

describe("selectCompanionTarget", () => {
  it("returns source-gone when sourceId is not in leaves", () => {
    const leaves = [leaf("other", "x.md")];
    expect(selectCompanionTarget(leaves, "src", "companion.pdf")).toEqual({
      kind: "source-gone",
    });
  });

  it("returns source-gone for empty leaves array", () => {
    expect(selectCompanionTarget([], "src", "companion.pdf")).toEqual({
      kind: "source-gone",
    });
  });

  it("returns open+vacant when companion is open and a vacant pane exists", () => {
    const leaves = [
      leaf("src", "paper.md"),
      leaf("open", "companion.pdf"),
      leaf("empty"),
    ];
    expect(selectCompanionTarget(leaves, "src", "companion.pdf")).toEqual({
      kind: "open+vacant",
      openId: "open",
      vacantId: "empty",
    });
  });

  it("returns open-only when companion is open but no vacant pane exists", () => {
    const leaves = [leaf("src", "paper.md"), leaf("other", "companion.pdf")];
    expect(selectCompanionTarget(leaves, "src", "companion.pdf")).toEqual({
      kind: "open-only",
      openId: "other",
    });
  });

  it("does not match source leaf itself for open", () => {
    const leaves = [leaf("src", "companion.pdf")];
    expect(selectCompanionTarget(leaves, "src", "companion.pdf")).toEqual({
      kind: "must-split",
    });
  });

  it("returns vacant-only when a non-source leaf has no page", () => {
    const leaves = [leaf("src", "paper.md"), leaf("empty")];
    expect(selectCompanionTarget(leaves, "src", "companion.pdf")).toEqual({
      kind: "vacant-only",
      vacantId: "empty",
    });
  });

  it("returns reuse targeting next non-source leaf when all others have pages", () => {
    const leaves = [leaf("src", "paper.md"), leaf("other", "other.md")];
    expect(selectCompanionTarget(leaves, "src", "companion.pdf")).toEqual({
      kind: "reuse",
      paneId: "other",
    });
  });

  it("returns must-split when source is the only leaf", () => {
    const leaves = [leaf("src", "paper.md")];
    expect(selectCompanionTarget(leaves, "src", "companion.pdf")).toEqual({
      kind: "must-split",
    });
  });

  it("wraps around to first pane when source is last", () => {
    const leaves = [leaf("a", "a.md"), leaf("b", "b.md"), leaf("src", "paper.md")];
    expect(selectCompanionTarget(leaves, "src", "companion.pdf")).toEqual({
      kind: "reuse",
      paneId: "a",
    });
  });

  it("picks immediately-next leaf after source", () => {
    const leaves = [leaf("src", "paper.md"), leaf("b", "b.md"), leaf("c", "c.md")];
    expect(selectCompanionTarget(leaves, "src", "companion.pdf")).toEqual({
      kind: "reuse",
      paneId: "b",
    });
  });

  it("picks next leaf when source is in middle", () => {
    const leaves = [leaf("a", "a.md"), leaf("src", "paper.md"), leaf("c", "c.md")];
    expect(selectCompanionTarget(leaves, "src", "companion.pdf")).toEqual({
      kind: "reuse",
      paneId: "c",
    });
  });
});

describe("resolveEditorPageIndex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns page index when editor view exists", () => {
    const fakeView = {
      state: { doc: {}, selection: { main: { head: 42 } } },
    };
    mockGetPaneView.mockReturnValue(fakeView);
    const fakeMarkers = [{ page: 1, charOffset: 0 }, { page: 2, charOffset: 30 }];
    mockGetCachedPageMarkers.mockReturnValue(fakeMarkers);
    mockPageForOffset.mockReturnValue(1);

    expect(resolveEditorPageIndex("pane-a")).toBe(1);
    expect(mockGetPaneView).toHaveBeenCalledWith("pane-a");
    expect(mockGetCachedPageMarkers).toHaveBeenCalledWith(fakeView.state.doc);
    expect(mockPageForOffset).toHaveBeenCalledWith(fakeMarkers, 42);
  });

  it("returns null when editor view is not available", () => {
    mockGetPaneView.mockReturnValue(null);

    expect(resolveEditorPageIndex("pane-a")).toBeNull();
    expect(mockGetCachedPageMarkers).not.toHaveBeenCalled();
    expect(mockPageForOffset).not.toHaveBeenCalled();
  });

  it("returns 0 when cursor is before all markers", () => {
    const fakeView = {
      state: { doc: {}, selection: { main: { head: 0 } } },
    };
    mockGetPaneView.mockReturnValue(fakeView);
    mockGetCachedPageMarkers.mockReturnValue([{ page: 1, charOffset: 10 }]);
    mockPageForOffset.mockReturnValue(0);

    expect(resolveEditorPageIndex("pane-a")).toBe(0);
  });
});

describe("resolvePdfPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLinkState.currentPage.clear();
  });

  it("returns value from getPdfCurrentPage when available", () => {
    mockGetPdfCurrentPage.mockReturnValue(7);

    expect(resolvePdfPage("pane-a")).toBe(7);
    expect(mockGetPdfCurrentPage).toHaveBeenCalledWith("pane-a");
  });

  it("falls back to store currentPage when getPdfCurrentPage returns null", () => {
    mockGetPdfCurrentPage.mockReturnValue(null);
    mockLinkState.currentPage.set("pane-a", 5);

    expect(resolvePdfPage("pane-a")).toBe(5);
  });

  it("returns 0 when both sources return null/undefined", () => {
    mockGetPdfCurrentPage.mockReturnValue(null);

    expect(resolvePdfPage("pane-a")).toBe(0);
  });
});

function resetPaneState(pagePath: string | null) {
  mockPaneState.root = { type: "leaf", id: "src-pane", pagePath };
  mockPaneState.focusedPaneId = "src-pane";
}

describe("initCompanionCommands", () => {
  beforeEach(() => {
    _clear();
    vi.clearAllMocks();
    resetPaneState("paper.md");
    mockFindCompanionFile.mockResolvedValue("paper.pdf");
    mockLinkState.syncEnabled = true;
  });

  it("registers companion.open", () => {
    initCompanionCommands();
    expect(hasCommand("companion.open")).toBe(true);
  });

  it("splits the focused pane, loads the companion, and links the panes", async () => {
    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockPaneState.splitPane).toHaveBeenCalledWith("src-pane", "horizontal");
      expect(mockPaneState.setPanePage).toHaveBeenCalledWith("new-pane", "paper.pdf");
      expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "new-pane");
      expect(mockPaneState.focusPane).toHaveBeenCalledWith("new-pane");
    });
  });

  it("reuses a vacant pane instead of splitting", async () => {
    mockPaneState.root = {
      type: "split",
      id: "root",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "src-pane", pagePath: "paper.md" },
        { type: "leaf", id: "vacant-pane", pagePath: null },
      ],
      sizes: [0.5, 0.5],
    };
    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockPaneState.splitPane).not.toHaveBeenCalled();
      expect(mockPaneState.setPanePage).toHaveBeenCalledWith("vacant-pane", "paper.pdf");
      expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "vacant-pane");
      expect(mockPaneState.focusPane).toHaveBeenCalledWith("vacant-pane");
    });
  });

  it("reuses pane already showing the companion file and navigates PDF to cursor page", async () => {
    mockPaneState.root = {
      type: "split",
      id: "root",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "src-pane", pagePath: "paper.md" },
        { type: "leaf", id: "companion-pane", pagePath: "paper.pdf" },
      ],
      sizes: [0.5, 0.5],
    };
    const fakeView = {
      state: { doc: {}, selection: { main: { head: 42 } } },
    };
    mockGetPaneView.mockReturnValue(fakeView);
    const fakeMarkers = [{ page: 1, charOffset: 0 }, { page: 2, charOffset: 30 }];
    mockGetCachedPageMarkers.mockReturnValue(fakeMarkers);
    mockPageForOffset.mockReturnValue(1);
    const mockGoTo = vi.fn();
    mockGetPdfGoToPage.mockReturnValue(mockGoTo);
    mockMarkForwardSync.mockReturnValue(42);

    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockPaneState.splitPane).not.toHaveBeenCalled();
      expect(mockPaneState.setPanePage).not.toHaveBeenCalled();
      expect(mockPaneState.focusPane).toHaveBeenCalledWith("companion-pane");
      expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "companion-pane");
      expect(mockStatusState.show).toHaveBeenCalledWith(
        expect.stringContaining("paper.pdf"),
        "success",
      );
      expect(mockLinkState.setPendingPdfSync).not.toHaveBeenCalled();
      expect(mockLinkState.setPendingEditorSync).not.toHaveBeenCalled();
      expect(mockGoTo).toHaveBeenCalledWith(1);
      expect(mockMarkForwardSync).toHaveBeenCalledWith("companion-pane");
    });
  });

  it("prefers already-open pane over vacant pane", async () => {
    mockPaneState.root = {
      type: "split",
      id: "root",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "src-pane", pagePath: "paper.md" },
        { type: "leaf", id: "companion-pane", pagePath: "paper.pdf" },
        { type: "leaf", id: "vacant-pane", pagePath: null },
      ],
      sizes: [0.33, 0.34, 0.33],
    };
    mockGetPaneView.mockReturnValue(null);
    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockPaneState.splitPane).not.toHaveBeenCalled();
      expect(mockPaneState.setPanePage).not.toHaveBeenCalled();
      expect(mockPaneState.focusPane).toHaveBeenCalledWith("companion-pane");
      expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "companion-pane");
      expect(mockStatusState.show).toHaveBeenCalledWith(
        expect.stringContaining("paper.pdf"),
        "success",
      );
      expect(mockLinkState.setPendingPdfSync).not.toHaveBeenCalled();
      expect(mockLinkState.setPendingEditorSync).not.toHaveBeenCalled();
    });
  });

  it("dispatches reverse sync for already-open markdown (PDF→md)", async () => {
    resetPaneState("paper.pdf");
    mockFindCompanionFile.mockResolvedValue("paper.md");
    mockPaneState.root = {
      type: "split",
      id: "root",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "src-pane", pagePath: "paper.pdf" },
        { type: "leaf", id: "companion-pane", pagePath: "paper.md" },
      ],
      sizes: [0.5, 0.5],
    };
    mockGetPdfCurrentPage.mockReturnValue(3);
    const fakeView = { state: { doc: {} } };
    mockGetPaneView.mockReturnValue(fakeView);
    const fakeMarkers = [{ page: 1, charOffset: 0 }, { page: 2, charOffset: 30 }, { page: 3, charOffset: 60 }, { page: 4, charOffset: 90 }];
    mockGetCachedPageMarkers.mockReturnValue(fakeMarkers);

    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "companion-pane");
      expect(mockDispatchReverseSync).toHaveBeenCalledWith(
        3,
        "companion-pane",
        fakeMarkers,
        { skipGuards: true, clampIndex: true },
      );
    });
  });

  it("no-ops gracefully when editor view is null in already-open md→PDF path", async () => {
    mockPaneState.root = {
      type: "split",
      id: "root",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "src-pane", pagePath: "paper.md" },
        { type: "leaf", id: "companion-pane", pagePath: "paper.pdf" },
      ],
      sizes: [0.5, 0.5],
    };
    mockGetPaneView.mockReturnValue(null);
    mockGetPdfGoToPage.mockReturnValue(vi.fn());

    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "companion-pane");
    });
    expect(mockGetPdfGoToPage).not.toHaveBeenCalled();
    expect(mockMarkForwardSync).not.toHaveBeenCalled();
  });

  it("no-ops gracefully when goToPage is not registered in already-open md→PDF path", async () => {
    mockPaneState.root = {
      type: "split",
      id: "root",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "src-pane", pagePath: "paper.md" },
        { type: "leaf", id: "companion-pane", pagePath: "paper.pdf" },
      ],
      sizes: [0.5, 0.5],
    };
    const fakeView = {
      state: { doc: {}, selection: { main: { head: 10 } } },
    };
    mockGetPaneView.mockReturnValue(fakeView);
    mockGetCachedPageMarkers.mockReturnValue([{ page: 1, charOffset: 0 }]);
    mockPageForOffset.mockReturnValue(0);
    mockGetPdfGoToPage.mockReturnValue(null);

    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "companion-pane");
    });
    expect(mockMarkForwardSync).not.toHaveBeenCalled();
  });

  it("reuses next non-source pane when no vacant pane exists", async () => {
    mockPaneState.root = {
      type: "split",
      id: "root",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "src-pane", pagePath: "paper.md" },
        { type: "leaf", id: "other-pane", pagePath: "other.md" },
      ],
      sizes: [0.5, 0.5],
    };
    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockPaneState.splitPane).not.toHaveBeenCalled();
      expect(mockPaneState.setPanePage).toHaveBeenCalledWith("other-pane", "paper.pdf");
      expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "other-pane");
      expect(mockPaneState.focusPane).toHaveBeenCalledWith("other-pane");
    });
  });

  it("splits when source is the only pane", async () => {
    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockPaneState.splitPane).toHaveBeenCalledWith("src-pane", "horizontal");
      expect(mockPaneState.setPanePage).toHaveBeenCalledWith("new-pane", "paper.pdf");
    });
  });

  it("wraps around: reuses first leaf when source is last in order", async () => {
    mockPaneState.root = {
      type: "split",
      id: "root",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "first-pane", pagePath: "other.md" },
        { type: "leaf", id: "middle-pane", pagePath: "another.md" },
        { type: "leaf", id: "src-pane", pagePath: "paper.md" },
      ],
      sizes: [0.33, 0.34, 0.33],
    };
    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockPaneState.splitPane).not.toHaveBeenCalled();
      expect(mockPaneState.setPanePage).toHaveBeenCalledWith("first-pane", "paper.pdf");
      expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "first-pane");
      expect(mockPaneState.focusPane).toHaveBeenCalledWith("first-pane");
    });
  });

  it("calls findCompanionFile with the focused pane's path", async () => {
    initCompanionCommands();
    executeCommand("companion.open");
    await vi.waitFor(() => {
      expect(mockFindCompanionFile).toHaveBeenCalledWith("paper.md");
    });
  });

  it("shows an error and does not split when no companion exists", async () => {
    mockFindCompanionFile.mockResolvedValue(null);
    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockStatusState.show).toHaveBeenCalledWith(
        expect.stringContaining("companion"),
        "error",
      );
    });
    expect(mockPaneState.splitPane).not.toHaveBeenCalled();
  });

  it("opens markdown companion when the focused pane is a PDF (reverse)", async () => {
    resetPaneState("paper.pdf");
    mockFindCompanionFile.mockResolvedValue("paper.md");
    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockFindCompanionFile).toHaveBeenCalledWith("paper.pdf");
      expect(mockPaneState.setPanePage).toHaveBeenCalledWith("new-pane", "paper.md");
      expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "new-pane");
    });
  });

  it("is hidden when the focused pane has no page", () => {
    resetPaneState(null);
    initCompanionCommands();
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "companion.open")).toBeUndefined();
  });

  it("is visible when the focused pane has a page", () => {
    resetPaneState("paper.md");
    initCompanionCommands();
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "companion.open")).toBeDefined();
  });

  it("shows a success status message after linking the panes", async () => {
    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockStatusState.show).toHaveBeenCalledWith(
        expect.stringContaining("paper.pdf"),
        "success",
      );
    });
  });

  it("defensive: shows error when splitPane returns null (guards future regressions)", async () => {
    mockPaneState.splitPane.mockReturnValue(null);
    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockStatusState.show).toHaveBeenCalledWith(
        expect.stringContaining("maximum panes"),
        "error",
      );
    });
    expect(mockPaneState.setPanePage).not.toHaveBeenCalled();
    expect(mockLinkState.linkPanes).not.toHaveBeenCalled();
  });

  it("shows error when source pane was closed during async lookup", async () => {
    mockFindCompanionFile.mockImplementation(() => {
      // Simulate the source pane being closed while findCompanionFile is in flight.
      mockPaneState.root = {
        type: "leaf",
        id: "other-pane",
        pagePath: "other.md",
      };
      return Promise.resolve("paper.pdf");
    });
    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockStatusState.show).toHaveBeenCalledWith(
        "Source pane was closed",
        "error",
      );
    });
    expect(mockPaneState.splitPane).not.toHaveBeenCalled();
    expect(mockPaneState.setPanePage).not.toHaveBeenCalled();
    expect(mockLinkState.linkPanes).not.toHaveBeenCalled();
  });

  it("registers companion.toggleSync", () => {
    initCompanionCommands();
    expect(hasCommand("companion.toggleSync")).toBe(true);
  });

  it("executing companion.toggleSync calls toggleSync", () => {
    initCompanionCommands();
    executeCommand("companion.toggleSync");
    expect(mockLinkState.toggleSync).toHaveBeenCalledTimes(1);
  });

  it("companion.toggleSync shows 'Sync enabled' when newly enabled", () => {
    mockLinkState.syncEnabled = true;
    initCompanionCommands();
    executeCommand("companion.toggleSync");
    expect(mockStatusState.show).toHaveBeenCalledWith(
      expect.stringContaining("Sync enabled"),
      "success",
    );
  });

  it("companion.toggleSync shows 'Sync disabled' when newly disabled", () => {
    mockLinkState.syncEnabled = false;
    initCompanionCommands();
    executeCommand("companion.toggleSync");
    expect(mockStatusState.show).toHaveBeenCalledWith(
      expect.stringContaining("Sync disabled"),
      "success",
    );
  });

  describe("initial sync on companion.open", () => {
    beforeEach(() => {
      mockPaneState.splitPane.mockImplementation((_paneId: string, _direction: string): string | null => {
        mockPaneState.focusedPaneId = "new-pane";
        return "new-pane";
      });
    });

    it("sets pendingPdfSync when source is markdown", async () => {
      resetPaneState("paper.md");
      const fakeView = {
        state: {
          doc: {},
          selection: { main: { head: 42 } },
        },
      };
      mockGetPaneView.mockReturnValue(fakeView);
      const fakeMarkers = [{ page: 1, charOffset: 0 }, { page: 2, charOffset: 30 }];
      mockGetCachedPageMarkers.mockReturnValue(fakeMarkers);
      mockPageForOffset.mockReturnValue(1);

      initCompanionCommands();
      executeCommand("companion.open");

      await vi.waitFor(() => {
        expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "new-pane");
      });
      expect(mockLinkState.setPendingPdfSync).toHaveBeenCalledWith("new-pane", 1);
      expect(mockLinkState.setPendingEditorSync).not.toHaveBeenCalled();
    });

    it("sets pendingEditorSync when source is PDF", async () => {
      resetPaneState("paper.pdf");
      mockFindCompanionFile.mockResolvedValue("paper.md");
      mockGetPdfCurrentPage.mockReturnValue(3);

      initCompanionCommands();
      executeCommand("companion.open");

      await vi.waitFor(() => {
        expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "new-pane");
      });
      expect(mockLinkState.setPendingEditorSync).toHaveBeenCalledWith("new-pane", 3);
      expect(mockLinkState.setPendingPdfSync).not.toHaveBeenCalled();
    });

    it("falls back to store currentPage when getPdfCurrentPage returns null", async () => {
      resetPaneState("paper.pdf");
      mockFindCompanionFile.mockResolvedValue("paper.md");
      mockGetPdfCurrentPage.mockReturnValue(null);
      mockLinkState.currentPage.set("src-pane", 5);

      initCompanionCommands();
      executeCommand("companion.open");

      await vi.waitFor(() => {
        expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "new-pane");
      });
      expect(mockLinkState.setPendingEditorSync).toHaveBeenCalledWith("new-pane", 5);
    });

    it("does not set pendingPdfSync when source editor has no view", async () => {
      resetPaneState("paper.md");
      mockGetPaneView.mockReturnValue(null);

      initCompanionCommands();
      executeCommand("companion.open");

      await vi.waitFor(() => {
        expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "new-pane");
      });
      expect(mockLinkState.setPendingPdfSync).not.toHaveBeenCalled();
    });
  });
});
