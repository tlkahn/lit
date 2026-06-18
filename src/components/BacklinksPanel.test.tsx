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
    graphReady: true,
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

  // Cycle 5: Display backlink entries
  it("displays backlink entries", async () => {
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
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
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

  it("calls onCountChange with entry count when entries arrive", async () => {
    const spy = vi.fn();
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks")
        return [makeEntry(), makeEntry({ source_id: "b.md" }), makeEntry({ source_id: "c.md" })];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<BacklinksPanel pageId="target.md" onCountChange={spy} />);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(3);
    });
  });

  it("calls onCountChange with 0 when empty", async () => {
    const spy = vi.fn();
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<BacklinksPanel pageId="target.md" onCountChange={spy} />);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(0);
    });
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
      expect(screen.getByText("First")).toBeInTheDocument();
    });

    act(() => {
      emitMockEvent("lit:graph-updated", {});
    });

    await waitFor(() => {
      expect(screen.getByText("Second")).toBeInTheDocument();
    });
  });

  describe("virtualization", () => {
    it("renders all entries when scroll container is large enough", async () => {
      const entries = Array.from({ length: 10 }, (_, i) =>
        makeEntry({ source_id: `p${i}.md`, source_title: `Page ${i}`, context: `ctx ${i}` }),
      );
      mockInvoke((cmd) => {
        if (cmd === "get_backlinks") return entries;
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<BacklinksPanel pageId="target.md" />);

      await waitFor(() => {
        expect(screen.getByText("Page 0")).toBeInTheDocument();
      });
      for (let i = 0; i < 10; i++) {
        expect(screen.getByText(`Page ${i}`)).toBeInTheDocument();
      }
    });

    it("has a scroll container with data-testid", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_backlinks") return [makeEntry()];
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<BacklinksPanel pageId="target.md" />);

      await waitFor(() => {
        expect(screen.getByText("Alpha")).toBeInTheDocument();
      });
      expect(screen.getByTestId("backlinks-scroll-container")).toBeInTheDocument();
    });

    it("existing data-testid backlink-context-N still works", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_backlinks")
          return [makeEntry({ context: "see [[target]]" })];
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<BacklinksPanel pageId="target.md" />);

      await waitFor(() => {
        expect(screen.getByTestId("backlink-context-0")).toBeInTheDocument();
      });
    });
  });

  describe("graphReady guard", () => {
    it("shows building-index spinner when graphReady is false", async () => {
      useWorkspaceStore.setState({ graphReady: false });
      mockInvoke(() => {
        throw new Error("should not be called");
      });

      render(<BacklinksPanel pageId="target.md" />);

      expect(screen.getByText("Building index...")).toBeInTheDocument();
      expect(screen.queryByText("No other pages link to this page")).not.toBeInTheDocument();
    });

    it("does not call getBacklinks when graphReady is false", async () => {
      useWorkspaceStore.setState({ graphReady: false });
      const invokeSpy = vi.fn();
      mockInvoke(invokeSpy);

      render(<BacklinksPanel pageId="target.md" />);

      expect(invokeSpy).not.toHaveBeenCalled();
    });

    it("fetches backlinks when graphReady becomes true", async () => {
      useWorkspaceStore.setState({ graphReady: false });
      mockInvoke((cmd) => {
        if (cmd === "get_backlinks") return [makeEntry({ source_title: "Arrived" })];
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<BacklinksPanel pageId="target.md" />);
      expect(screen.getByText("Building index...")).toBeInTheDocument();

      act(() => {
        useWorkspaceStore.setState({ graphReady: true });
      });

      await waitFor(() => {
        expect(screen.getByText("Arrived")).toBeInTheDocument();
      });
      expect(screen.queryByText("Building index...")).not.toBeInTheDocument();
    });

    it("does not call onCountChange when graphReady is false", () => {
      useWorkspaceStore.setState({ graphReady: false });
      const spy = vi.fn();
      mockInvoke(() => {
        throw new Error("should not be called");
      });

      render(<BacklinksPanel pageId="target.md" onCountChange={spy} />);

      expect(spy).not.toHaveBeenCalled();
    });
  });

  it("logs warning when IPC call fails", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks") throw new Error("IPC failure");
      throw new Error(`Unknown command: ${cmd}`);
    });

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<BacklinksPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("No other pages link to this page")).toBeInTheDocument();
    });
    expect(consoleSpy).toHaveBeenCalledWith("Failed to fetch backlinks:", expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("discards stale fetch results when pageId changes during in-flight IPC call", async () => {
    let firstCallResolve: ((value: BacklinkEntry[]) => void) | undefined;
    let callCount = 0;

    mockInvoke((cmd, args) => {
      if (cmd === "get_backlinks") {
        callCount++;
        const pid = (args as Record<string, unknown>)?.pageId;
        if (callCount === 1 && pid === "first.md") {
          // First call: return a deferred promise that we control
          return new Promise<BacklinkEntry[]>((resolve) => {
            firstCallResolve = resolve;
          });
        }
        if (pid === "second.md") {
          // Second call: resolve immediately
          return [makeEntry({ source_title: "ForSecond" })];
        }
        return [];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { rerender } = render(<BacklinksPanel pageId="first.md" />);

    // Immediately rerender with a different pageId before first fetch resolves
    rerender(<BacklinksPanel pageId="second.md" />);

    // Wait for the second (immediate) fetch to populate the DOM
    await waitFor(() => {
      expect(screen.getByText("ForSecond")).toBeInTheDocument();
    });

    // Now resolve the first (stale) fetch
    await act(async () => {
      firstCallResolve!([makeEntry({ source_title: "ForFirst" })]);
    });

    // The stale result should NOT appear — ForSecond should remain
    expect(screen.queryByText("ForFirst")).not.toBeInTheDocument();
    expect(screen.getByText("ForSecond")).toBeInTheDocument();
  });

  it("skips IPC on graph-updated when active=false and refetches when active becomes true", async () => {
    let callCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks") {
        callCount++;
        return [makeEntry({ source_title: `Call${callCount}` })];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    const { rerender } = render(<BacklinksPanel pageId="target.md" active={false} />);

    // Wait for initial mount fetch
    await waitFor(() => {
      expect(callCount).toBe(1);
    });

    // Fire graph-updated while inactive — should NOT trigger another fetch
    act(() => {
      emitMockEvent("lit:graph-updated", {});
    });

    // Give time for any async call to fire
    await act(async () => {});
    expect(callCount).toBe(1);

    // Now activate — should trigger stale refetch
    rerender(<BacklinksPanel pageId="target.md" active={true} />);

    await waitFor(() => {
      expect(callCount).toBe(2);
    });
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
