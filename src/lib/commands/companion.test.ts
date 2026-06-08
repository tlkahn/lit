import { describe, it, expect, vi, beforeEach } from "vitest";
import { _clear, hasCommand, executeCommand, getVisibleCommands } from "../commandRegistry";

// --- pane store mock -------------------------------------------------------
const mockPaneState = vi.hoisted(() => {
  const state = {
    root: {
      type: "leaf" as const,
      id: "src-pane",
      pagePath: "paper.md" as string | null,
    },
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

import { initCompanionCommands } from "./companion";

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
    } as any;
    initCompanionCommands();
    executeCommand("companion.open");

    await vi.waitFor(() => {
      expect(mockPaneState.splitPane).not.toHaveBeenCalled();
      expect(mockPaneState.setPanePage).toHaveBeenCalledWith("vacant-pane", "paper.pdf");
      expect(mockLinkState.linkPanes).toHaveBeenCalledWith("src-pane", "vacant-pane");
      expect(mockPaneState.focusPane).toHaveBeenCalledWith("vacant-pane");
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
    } as any;
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
});
