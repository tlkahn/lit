import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/ipc", () => ({
  materializeCitation: vi.fn(),
}));

vi.mock("../stores/workspace", () => {
  const selectPageFn = vi.fn();
  let pages: unknown[] = [];
  return {
    useWorkspaceStore: {
      getState: vi.fn(() => ({ selectPage: selectPageFn, pages })),
      setState: vi.fn((updater: (state: { pages: unknown[] }) => { pages: unknown[] }) => {
        if (typeof updater === "function") {
          const result = updater({ pages });
          pages = result.pages;
        }
      }),
      _resetForTest: () => {
        pages = [];
        selectPageFn.mockReset();
      },
      _getSelectPage: () => selectPageFn,
    },
  };
});

import { materializeAndOpen } from "./materializeAndOpen";
import { materializeCitation } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";

const materializeMock = vi.mocked(materializeCitation);
const store = useWorkspaceStore as unknown as {
  getState: ReturnType<typeof vi.fn>;
  setState: ReturnType<typeof vi.fn>;
  _resetForTest: () => void;
  _getSelectPage: () => ReturnType<typeof vi.fn>;
};

describe("materializeAndOpen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store._resetForTest();
  });

  it("calls materializeCitation, appends to pages, records departure, and selects page in order", async () => {
    const meta = {
      title: "Note",
      relative_path: "note.md",
      frontmatter: {},
      created_at: null,
      modified_at: null,
      file_type: "markdown" as const,
    };
    const recordDeparture = vi.fn();
    const callOrder: string[] = [];

    materializeMock.mockImplementation(async () => {
      callOrder.push("materializeCitation");
      return meta;
    });
    store.setState.mockImplementation(
      (updater: (state: { pages: unknown[] }) => { pages: unknown[] }) => {
        callOrder.push("setState");
        if (typeof updater === "function") {
          updater({ pages: [] });
        }
      },
    );
    recordDeparture.mockImplementation(() => {
      callOrder.push("recordDeparture");
    });
    store.getState.mockImplementation(() => {
      return {
        selectPage: (...args: unknown[]) => {
          callOrder.push("selectPage");
          void args;
        },
      };
    });

    await materializeAndOpen("bibkey1", { recordDeparture });

    expect(callOrder).toEqual([
      "materializeCitation",
      "setState",
      "recordDeparture",
      "selectPage",
    ]);
  });

  it("skips recordDeparture when not provided", async () => {
    const meta = {
      title: "Note",
      relative_path: "note.md",
      frontmatter: {},
      created_at: null,
      modified_at: null,
      file_type: "markdown" as const,
    };
    materializeMock.mockResolvedValueOnce(meta);

    // Should not throw
    await materializeAndOpen("bibkey1");

    expect(materializeMock).toHaveBeenCalledWith("bibkey1");
    expect(store.setState).toHaveBeenCalled();
  });

  it("propagates materializeCitation rejection without catching", async () => {
    const error = new Error("IPC failed");
    materializeMock.mockRejectedValueOnce(error);

    await expect(materializeAndOpen("bibkey1")).rejects.toThrow("IPC failed");

    // selectPage should NOT have been called
    const selectPage = store._getSelectPage();
    expect(selectPage).not.toHaveBeenCalled();
  });

  it("appends the returned PageMeta to the pages array", async () => {
    const existing = {
      title: "Existing",
      relative_path: "existing.md",
      frontmatter: {},
      created_at: null,
      modified_at: null,
      file_type: "markdown" as const,
    };
    const newMeta = {
      title: "New",
      relative_path: "new.md",
      frontmatter: {},
      created_at: null,
      modified_at: null,
      file_type: "markdown" as const,
    };
    materializeMock.mockResolvedValueOnce(newMeta);

    // Capture the updater function passed to setState
    let capturedUpdater: ((state: { pages: unknown[] }) => { pages: unknown[] }) | null = null;
    store.setState.mockImplementation(
      (updater: (state: { pages: unknown[] }) => { pages: unknown[] }) => {
        capturedUpdater = updater;
      },
    );

    await materializeAndOpen("bibkey1");

    expect(capturedUpdater).not.toBeNull();
    const result = capturedUpdater!({ pages: [existing] });
    expect(result.pages).toEqual([existing, newMeta]);
  });
});
