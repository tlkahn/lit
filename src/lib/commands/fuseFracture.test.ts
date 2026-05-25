import { describe, it, expect, vi, beforeEach } from "vitest";
import { _clear, getAllCommands, getVisibleCommands, hasCommand, executeCommand } from "../commandRegistry";
import { mockInvoke } from "../../test/tauri-mock";
import type { PageContent, SplitPlan } from "../ipc";

const mockGraphSelectionState = vi.hoisted(() => ({
  selectedNodes: [] as string[],
}));

const mockWorkspaceState = vi.hoisted(() => ({
  workspacePath: "/tmp/vault" as string | null,
  currentPagePath: "hello.md" as string | null,
  refreshPages: vi.fn(),
  triggerReload: vi.fn(),
}));

vi.mock("../../stores/graphSelection", () => ({
  useGraphSelectionStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockGraphSelectionState),
    { getState: () => mockGraphSelectionState },
  ),
}));

vi.mock("../../stores/workspace", () => ({
  useWorkspaceStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockWorkspaceState),
    { getState: () => mockWorkspaceState },
  ),
}));

const mockStatusMessageState = vi.hoisted(() => ({
  message: null as string | null,
  variant: "success" as string,
  show: vi.fn(),
}));

vi.mock("../../stores/statusMessage", () => ({
  useStatusMessageStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockStatusMessageState),
    { getState: () => mockStatusMessageState },
  ),
}));

import { initFuseFractureCommands } from "./fuseFracture";

describe("initFuseFractureCommands", () => {
  beforeEach(() => {
    _clear();
    vi.clearAllMocks();
    mockGraphSelectionState.selectedNodes = [];
    mockWorkspaceState.workspacePath = "/tmp/vault";
    mockWorkspaceState.currentPagePath = "hello.md";
    mockWorkspaceState.refreshPages.mockClear();
    mockWorkspaceState.triggerReload.mockClear();
    mockStatusMessageState.show.mockClear();
  });

  it("registers lit.mergeDocuments and lit.splitDocument", () => {
    initFuseFractureCommands();
    expect(hasCommand("lit.mergeDocuments")).toBe(true);
    expect(hasCommand("lit.splitDocument")).toBe(true);
    expect(getAllCommands()).toHaveLength(3);
  });

  it("calling initFuseFractureCommands twice does not duplicate", () => {
    initFuseFractureCommands();
    initFuseFractureCommands();
    expect(getAllCommands()).toHaveLength(3);
  });

  it("lit.mergeDocuments is hidden when selectedNodes is empty", () => {
    initFuseFractureCommands();
    mockGraphSelectionState.selectedNodes = [];
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "lit.mergeDocuments")).toBeUndefined();
  });

  it("lit.mergeDocuments is hidden when selectedNodes has only 1 node", () => {
    initFuseFractureCommands();
    mockGraphSelectionState.selectedNodes = ["a.md"];
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "lit.mergeDocuments")).toBeUndefined();
  });

  it("lit.mergeDocuments is visible when selectedNodes.length >= 2", () => {
    initFuseFractureCommands();
    mockGraphSelectionState.selectedNodes = ["a.md", "b.md"];
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "lit.mergeDocuments")).toBeDefined();
  });

  it("lit.splitDocument is hidden when currentPagePath is null", () => {
    initFuseFractureCommands();
    mockWorkspaceState.currentPagePath = null;
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "lit.splitDocument")).toBeUndefined();
  });

  it("lit.splitDocument is visible when currentPagePath is set", () => {
    initFuseFractureCommands();
    mockWorkspaceState.currentPagePath = "hello.md";
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "lit.splitDocument")).toBeDefined();
  });

  it("lit.mergeDocuments is searchable by keyword 'fuse'", () => {
    initFuseFractureCommands();
    mockGraphSelectionState.selectedNodes = ["a.md", "b.md"];
    const visible = getVisibleCommands("fuse");
    expect(visible.find((c) => c.id === "lit.mergeDocuments")).toBeDefined();
  });

  it("lit.splitDocument is searchable by keyword 'fracture'", () => {
    initFuseFractureCommands();
    mockWorkspaceState.currentPagePath = "hello.md";
    const visible = getVisibleCommands("fracture");
    expect(visible.find((c) => c.id === "lit.splitDocument")).toBeDefined();
  });

  describe("command actions", () => {
    const docA: PageContent = {
      meta: { title: "Alpha", relative_path: "a.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" },
      body: "body A",
      raw_yaml: "",
    };
    const docB: PageContent = {
      meta: { title: "Beta", relative_path: "b.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" },
      body: "body B",
      raw_yaml: "",
    };

    it("lit.mergeDocuments dispatches lit:open-merge-preview with loaded docs", async () => {
      initFuseFractureCommands();
      mockGraphSelectionState.selectedNodes = ["a.md", "b.md"];

      mockInvoke((cmd, args) => {
        if (cmd === "read_page") {
          const path = (args as Record<string, string>).relativePath;
          if (path === "a.md") return docA;
          if (path === "b.md") return docB;
        }
        return null;
      });

      const dispatchSpy = vi.spyOn(window, "dispatchEvent");
      executeCommand("lit.mergeDocuments");

      await vi.waitFor(() => {
        const call = dispatchSpy.mock.calls.find(
          (c) => (c[0] as CustomEvent).type === "lit:open-merge-preview",
        );
        expect(call).toBeDefined();
        const detail = (call![0] as CustomEvent).detail;
        expect(detail.docs).toEqual([docA, docB]);
      });

      dispatchSpy.mockRestore();
    });

    it("lit.splitDocument dispatches lit:open-split-preview with plan and path", async () => {
      initFuseFractureCommands();
      mockWorkspaceState.currentPagePath = "hello.md";

      const splitPlan: SplitPlan = {
        preamble: null,
        sections: [
          { title: "Section 1", body: "body 1", frontmatter: {} },
          { title: "Section 2", body: "body 2", frontmatter: {} },
        ],
      };

      const pageContent: PageContent = {
        meta: { title: "Hello", relative_path: "hello.md", frontmatter: { tag: "test" }, created_at: null, modified_at: null, file_type: "markdown" },
        body: "# Section 1\nbody 1\n# Section 2\nbody 2",
        raw_yaml: "",
      };

      mockInvoke((cmd) => {
        if (cmd === "read_page") return pageContent;
        if (cmd === "preview_split") return splitPlan;
        return null;
      });

      const dispatchSpy = vi.spyOn(window, "dispatchEvent");
      executeCommand("lit.splitDocument");

      await vi.waitFor(() => {
        const call = dispatchSpy.mock.calls.find(
          (c) => (c[0] as CustomEvent).type === "lit:open-split-preview",
        );
        expect(call).toBeDefined();
        const detail = (call![0] as CustomEvent).detail;
        expect(detail.plan).toEqual(splitPlan);
        expect(detail.originalPath).toBe("hello.md");
      });

      dispatchSpy.mockRestore();
    });
  });

  describe("lit.undoOperation", () => {
    it("is registered with correct label and keywords", () => {
      initFuseFractureCommands();
      expect(hasCommand("lit.undoOperation")).toBe(true);
      const cmds = getAllCommands();
      const undo = cmds.find((c) => c.id === "lit.undoOperation");
      expect(undo!.label).toBe("Undo last merge/split");
      expect(undo!.keywords).toEqual(["undo", "revert", "rollback"]);
    });

    it("is visible when workspace is open", () => {
      initFuseFractureCommands();
      mockWorkspaceState.workspacePath = "/tmp/vault";
      const visible = getVisibleCommands("undo");
      expect(visible.find((c) => c.id === "lit.undoOperation")).toBeDefined();
    });

    it("is hidden when workspace is not open", () => {
      initFuseFractureCommands();
      mockWorkspaceState.workspacePath = null;
      const visible = getVisibleCommands("undo");
      expect(visible.find((c) => c.id === "lit.undoOperation")).toBeUndefined();
    });

    it("calls undo_last_operation IPC", async () => {
      initFuseFractureCommands();
      mockInvoke((cmd) => {
        if (cmd === "undo_last_operation") return "Merge A+B";
        if (cmd === "rebuild_graph_index") return "ok";
        return null;
      });

      executeCommand("lit.undoOperation");

      await vi.waitFor(() => {
        expect(mockStatusMessageState.show).toHaveBeenCalled();
      });
    });

    it("calls rebuildGraphIndex after undo", async () => {
      initFuseFractureCommands();
      const calledCommands: string[] = [];
      mockInvoke((cmd) => {
        calledCommands.push(cmd);
        if (cmd === "undo_last_operation") return "Merge A+B";
        if (cmd === "rebuild_graph_index") return "ok";
        return null;
      });

      executeCommand("lit.undoOperation");

      await vi.waitFor(() => {
        expect(calledCommands).toContain("rebuild_graph_index");
      });
    });

    it("calls refreshPages and triggerReload after undo", async () => {
      initFuseFractureCommands();
      mockInvoke((cmd) => {
        if (cmd === "undo_last_operation") return "Merge A+B";
        if (cmd === "rebuild_graph_index") return "ok";
        return null;
      });

      executeCommand("lit.undoOperation");

      await vi.waitFor(() => {
        expect(mockWorkspaceState.refreshPages).toHaveBeenCalled();
        expect(mockWorkspaceState.triggerReload).toHaveBeenCalled();
      });
    });

    it("shows success message with description after undo", async () => {
      initFuseFractureCommands();
      mockInvoke((cmd) => {
        if (cmd === "undo_last_operation") return "Merge A+B";
        if (cmd === "rebuild_graph_index") return "ok";
        return null;
      });

      executeCommand("lit.undoOperation");

      await vi.waitFor(() => {
        expect(mockStatusMessageState.show).toHaveBeenCalledWith("Undid: Merge A+B");
      });
    });

    it("shows error message when undo fails", async () => {
      initFuseFractureCommands();
      mockInvoke((cmd) => {
        if (cmd === "undo_last_operation") throw new Error("Nothing to undo");
        return null;
      });

      executeCommand("lit.undoOperation");

      await vi.waitFor(() => {
        expect(mockStatusMessageState.show).toHaveBeenCalledWith(
          expect.stringContaining("Nothing to undo"),
          "error",
        );
      });
    });
  });
});
