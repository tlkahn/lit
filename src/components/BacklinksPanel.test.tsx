import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BacklinksPanel } from "./BacklinksPanel";
import { mockInvoke, mockListen, emitMockEvent } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { globalJumpTracker } from "../editor/jumpTracker";
import { setCurrentEditorView } from "../lib/editorViewRef";
import type { BacklinkEntry } from "../lib/ipc";

function makeEntry(overrides: Partial<BacklinkEntry> = {}): BacklinkEntry {
  return {
    source_id: "a.md",
    source_title: "Alpha",
    context: "links to target",
    source_line: 1,
    ...overrides,
  };
}

beforeEach(() => {
  useWorkspaceStore.setState({
    workspacePath: "/test",
    currentPagePath: "target.md",
  });
});

describe("BacklinksPanel", () => {
  // Cycle 4: Empty state
  it("shows empty message when no backlinks", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<BacklinksPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("No other pages link to this page")).toBeInTheDocument();
    });
  });

  // Cycle 5: Display backlink entries with count
  it("displays backlink entries with count in header", async () => {
    const entries: BacklinkEntry[] = [
      makeEntry({ source_id: "a.md", source_title: "Alpha", context: "see [[target]]" }),
      makeEntry({ source_id: "b.md", source_title: "Beta", context: "links to [[target]]", source_line: 5 }),
    ];
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks") return entries;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<BacklinksPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("Linked References (2)")).toBeInTheDocument();
    });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  // Cycle 6: Highlight [[wikilink]] in context
  it("highlights [[wikilink]] in context text", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks")
        return [makeEntry({ context: "See [[PageA]] for details" })];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<BacklinksPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    const mark = screen.getByTestId("backlink-context-0");
    expect(mark.innerHTML).toContain("<span");
    expect(mark.textContent).toContain("[[PageA]]");
  });

  // Cycle 7: Click navigation
  const fakeEditorView = {
    state: {
      selection: { main: { head: 10 } },
      doc: { lineAt: () => ({ number: 3, from: 8 }) },
    },
  };

  it("navigates to source page on title click and records jump", async () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({ selectPage });
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks")
        return [makeEntry({ source_id: "a.md", source_title: "Alpha" })];
      throw new Error(`Unknown command: ${cmd}`);
    });

    setCurrentEditorView(fakeEditorView as never);
    const spy = vi.spyOn(globalJumpTracker, "recordJump");

    render(<BacklinksPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Alpha"));
    expect(selectPage).toHaveBeenCalledWith("a.md");
    expect(spy).toHaveBeenCalledWith(
      { notePath: "target.md", line: 3, col: 2 },
      { notePath: "", line: 0, col: 0 },
    );
    spy.mockRestore();
    setCurrentEditorView(null);
  });

  it("navigates to source page at line on context click and records jump", async () => {
    const selectPageAtLine = vi.fn();
    useWorkspaceStore.setState({ selectPageAtLine });
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks")
        return [makeEntry({ source_id: "a.md", source_line: 7, context: "some context" })];
      throw new Error(`Unknown command: ${cmd}`);
    });

    setCurrentEditorView(fakeEditorView as never);
    const spy = vi.spyOn(globalJumpTracker, "recordJump");

    render(<BacklinksPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByTestId("backlink-context-0")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId("backlink-context-0"));
    expect(selectPageAtLine).toHaveBeenCalledWith("a.md", 7);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    setCurrentEditorView(null);
  });

  // Cycle 8: Collapse/expand toggle
  it("collapses and expands on header click", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks")
        return [makeEntry({ source_title: "Alpha" })];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<BacklinksPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });

    // Click header to collapse
    await userEvent.click(screen.getByTestId("backlinks-header"));
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();

    // Click header to expand
    await userEvent.click(screen.getByTestId("backlinks-header"));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  // Cycle 9: Live refresh via lit:graph-updated event
  it("refetches on lit:graph-updated event", async () => {
    let callCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks") {
        callCount++;
        if (callCount === 1) return [makeEntry({ source_title: "First" })];
        return [
          makeEntry({ source_title: "First" }),
          makeEntry({ source_id: "b.md", source_title: "Second" }),
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    render(<BacklinksPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("Linked References (1)")).toBeInTheDocument();
    });

    act(() => {
      emitMockEvent("lit:graph-updated", {});
    });

    await waitFor(() => {
      expect(screen.getByText("Linked References (2)")).toBeInTheDocument();
    });
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("refetches when pageId changes", async () => {
    mockInvoke((cmd, args) => {
      if (cmd === "get_backlinks") {
        const pid = (args as Record<string, unknown>)?.pageId;
        if (pid === "first.md") return [makeEntry({ source_title: "ForFirst" })];
        if (pid === "second.md") return [makeEntry({ source_title: "ForSecond" })];
        return [];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { rerender } = render(<BacklinksPanel pageId="first.md" />);

    await waitFor(() => {
      expect(screen.getByText("ForFirst")).toBeInTheDocument();
    });

    rerender(<BacklinksPanel pageId="second.md" />);

    await waitFor(() => {
      expect(screen.getByText("ForSecond")).toBeInTheDocument();
    });
  });
});
