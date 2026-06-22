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

vi.mock("../pdfPaneRef", () => ({
  getPdfCurrentPage: mockGetPdfCurrentPage,
}));

// --- pageMarkers mock ------------------------------------------------------
const mockGetCachedPageMarkers = vi.hoisted(() => vi.fn());
const mockPageForOffset = vi.hoisted(() => vi.fn());

vi.mock("../pageMarkers", () => ({
  getCachedPageMarkers: mockGetCachedPageMarkers,
  pageForOffset: mockPageForOffset,
}));

import { initCompanionCommands, selectCompanionTarget } from "./companion";
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

  it("returns already-open when a non-source leaf has the companion path", () => {
    const leaves = [leaf("src", "paper.md"), leaf("other", "companion.pdf")];
    expect(selectCompanionTarget(leaves, "src", "companion.pdf")).toEqual({
      kind: "already-open",
      paneId: "other",
    });
  });

  it("does not match source leaf itself for already-open", () => {
    const leaves = [leaf("src", "companion.pdf")];
    expect(selectCompanionTarget(leaves, "src", "companion.pdf")).toEqual({
      kind: "split-needed",
    });
  });

  it("returns vacant when a non-source leaf has no page", () => {
    const leaves = [leaf("src", "paper.md"), leaf("empty")];
    expect(selectCompanionTarget(leaves, "src", "companion.pdf")).toEqual({
      kind: "vacant",
      paneId: "empty",
    });
  });

  it("returns split-needed when all non-source leaves have pages", () => {
    const leaves = [leaf("src", "paper.md"), leaf("other", "other.md")];
    expect(selectCompanionTarget(leaves, "src", "companion.pdf")).toEqual({
      kind: "split-needed",
    });
  });

  it("prefers already-open over vacant when both exist", () => {
    const leaves = [
      leaf("src", "paper.md"),
      leaf("open", "companion.pdf"),
      leaf("empty"),
    ];
    expect(selectCompanionTarget(leaves, "src", "companion.pdf")).toEqual({
      kind: "already-open",
      paneId: "open",
    });
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

  it("reuses the already-open pane instead of splitting", async () => {
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
    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockPaneState.splitPane).not.toHaveBeenCalled();
      expect(mockPaneState.setPanePage).toHaveBeenCalledWith("companion-pane", "paper.pdf");
      expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "companion-pane");
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
    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockPaneState.splitPane).not.toHaveBeenCalled();
      expect(mockPaneState.setPanePage).toHaveBeenCalledWith("companion-pane", "paper.pdf");
      expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "companion-pane");
    });
  });

  it("splits when no vacant pane exists (all panes have pages)", async () => {
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
      expect(mockPaneState.splitPane).toHaveBeenCalledWith("src-pane", "horizontal");
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

  it("shows error and does not clobber when splitPane is a no-op (MAX_PANES)", async () => {
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
    mockPaneState.splitPane.mockReturnValue(null);
    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockPaneState.splitPane).toHaveBeenCalledWith("src-pane", "horizontal");
      expect(mockStatusState.show).toHaveBeenCalledWith(
        expect.stringContaining("source pane closed"),
        "error",
      );
    });
    expect(mockPaneState.setPanePage).not.toHaveBeenCalled();
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
