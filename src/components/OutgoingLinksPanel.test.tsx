import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OutgoingLinksPanel } from "./OutgoingLinksPanel";
import { mockInvoke, mockListen, emitMockEvent } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { globalJumpTracker } from "../editor/jumpTracker";
import { setCurrentEditorView } from "../lib/editorViewRef";
import type { LinkEntry } from "../lib/ipc";

function makeEntry(overrides: Partial<LinkEntry> = {}): LinkEntry {
  return {
    target_id: "a.md",
    target_title: "Alpha",
    raw_target: "Alpha",
    context: "links to target",
    ...overrides,
  };
}

beforeEach(() => {
  useWorkspaceStore.setState({
    workspacePath: "/test",
    currentPagePath: "source.md",
    graphReady: true,
  });
});

describe("OutgoingLinksPanel", () => {
  it("shows empty message when no outgoing links", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_forward_links") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<OutgoingLinksPanel pageId="source.md" />);

    await waitFor(() => {
      expect(screen.getByText("This page does not link to any other pages")).toBeInTheDocument();
    });
  });

  it("displays outgoing link entries", async () => {
    const entries: LinkEntry[] = [
      makeEntry({ target_id: "a.md", target_title: "Alpha", context: "see [[Alpha]]" }),
      makeEntry({ target_id: "b.md", target_title: "Beta", context: "links to [[Beta]]" }),
    ];
    mockInvoke((cmd) => {
      if (cmd === "get_forward_links") return entries;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<OutgoingLinksPanel pageId="source.md" />);

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("highlights [[wikilink]] in context text", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_forward_links")
        return [makeEntry({ context: "See [[PageA]] for details" })];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<OutgoingLinksPanel pageId="source.md" />);

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    const mark = screen.getByTestId("outgoing-context-0");
    expect(mark.innerHTML).toContain("<span");
    expect(mark.textContent).toContain("[[PageA]]");
  });

  const fakeEditorView = {
    state: {
      selection: { main: { head: 10 } },
      doc: { lineAt: () => ({ number: 3, from: 8 }) },
    },
  };

  it("navigates to target page on title click and records jump", async () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({ selectPage });
    mockInvoke((cmd) => {
      if (cmd === "get_forward_links")
        return [makeEntry({ target_id: "a.md", target_title: "Alpha" })];
      throw new Error(`Unknown command: ${cmd}`);
    });

    setCurrentEditorView(fakeEditorView as never);
    const spy = vi.spyOn(globalJumpTracker, "recordJump");

    render(<OutgoingLinksPanel pageId="source.md" />);

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Alpha"));
    expect(selectPage).toHaveBeenCalledWith("a.md");
    expect(spy).toHaveBeenCalledWith(
      { notePath: "source.md", line: 3, col: 2 },
      { notePath: "", line: 0, col: 0 },
    );
    spy.mockRestore();
    setCurrentEditorView(null);
  });

  it("navigates to target page on context click and records jump", async () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({ selectPage });
    mockInvoke((cmd) => {
      if (cmd === "get_forward_links")
        return [makeEntry({ target_id: "a.md", context: "some context" })];
      throw new Error(`Unknown command: ${cmd}`);
    });

    setCurrentEditorView(fakeEditorView as never);
    const spy = vi.spyOn(globalJumpTracker, "recordJump");

    render(<OutgoingLinksPanel pageId="source.md" />);

    await waitFor(() => {
      expect(screen.getByTestId("outgoing-context-0")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId("outgoing-context-0"));
    expect(selectPage).toHaveBeenCalledWith("a.md");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    setCurrentEditorView(null);
  });

  it("calls onCountChange with entry count when entries arrive", async () => {
    const spy = vi.fn();
    mockInvoke((cmd) => {
      if (cmd === "get_forward_links")
        return [makeEntry(), makeEntry({ target_id: "b.md" }), makeEntry({ target_id: "c.md" })];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<OutgoingLinksPanel pageId="source.md" onCountChange={spy} />);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(3);
    });
  });

  it("calls onCountChange with 0 when empty", async () => {
    const spy = vi.fn();
    mockInvoke((cmd) => {
      if (cmd === "get_forward_links") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<OutgoingLinksPanel pageId="source.md" onCountChange={spy} />);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(0);
    });
  });

  it("refetches on lit:graph-updated event", async () => {
    let callCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "get_forward_links") {
        callCount++;
        if (callCount === 1) return [makeEntry({ target_title: "First" })];
        return [
          makeEntry({ target_title: "First" }),
          makeEntry({ target_id: "b.md", target_title: "Second" }),
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    render(<OutgoingLinksPanel pageId="source.md" />);

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

  it("has a scroll container with data-testid", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_forward_links") return [makeEntry()];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<OutgoingLinksPanel pageId="source.md" />);

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(screen.getByTestId("outgoing-scroll-container")).toBeInTheDocument();
  });

  describe("graphReady guard", () => {
    it("shows building-index spinner when graphReady is false", async () => {
      useWorkspaceStore.setState({ graphReady: false });
      mockInvoke(() => {
        throw new Error("should not be called");
      });

      render(<OutgoingLinksPanel pageId="source.md" />);

      expect(screen.getByTestId("outgoing-building")).toBeInTheDocument();
      expect(screen.queryByText("This page does not link to any other pages")).not.toBeInTheDocument();
    });

    it("fetches forward links when graphReady becomes true", async () => {
      useWorkspaceStore.setState({ graphReady: false });
      mockInvoke((cmd) => {
        if (cmd === "get_forward_links") return [makeEntry({ target_title: "Arrived" })];
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<OutgoingLinksPanel pageId="source.md" />);
      expect(screen.getByTestId("outgoing-building")).toBeInTheDocument();

      act(() => {
        useWorkspaceStore.setState({ graphReady: true });
      });

      await waitFor(() => {
        expect(screen.getByText("Arrived")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("outgoing-building")).not.toBeInTheDocument();
    });
  });

  it("refetches when pageId changes", async () => {
    mockInvoke((cmd, args) => {
      if (cmd === "get_forward_links") {
        const pid = (args as Record<string, unknown>)?.pageId;
        if (pid === "first.md") return [makeEntry({ target_title: "ForFirst" })];
        if (pid === "second.md") return [makeEntry({ target_title: "ForSecond" })];
        return [];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { rerender } = render(<OutgoingLinksPanel pageId="first.md" />);

    await waitFor(() => {
      expect(screen.getByText("ForFirst")).toBeInTheDocument();
    });

    rerender(<OutgoingLinksPanel pageId="second.md" />);

    await waitFor(() => {
      expect(screen.getByText("ForSecond")).toBeInTheDocument();
    });
  });
});
