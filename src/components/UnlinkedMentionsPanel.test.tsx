import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UnlinkedMentionsPanel } from "./UnlinkedMentionsPanel";
import { mockInvoke, mockListen, emitMockEvent } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import type { UnlinkedMention } from "../lib/ipc";

function makeMention(overrides: Partial<UnlinkedMention> = {}): UnlinkedMention {
  return {
    source_id: "c.md",
    source_title: "Gamma",
    context: "mentions Alpha in passing",
    source_line: 3,
    matched_text: "Alpha",
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

describe("UnlinkedMentionsPanel", () => {
  // Cycle 10.1 — Empty state
  it("shows empty message when no unlinked mentions", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<UnlinkedMentionsPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("No unlinked mentions found")).toBeInTheDocument();
    });
  });

  // Cycle 10.2 — Display entries
  it("displays entries when loaded", async () => {
    const entries: UnlinkedMention[] = [
      makeMention({ source_id: "c.md", source_title: "Gamma", matched_text: "Alpha" }),
      makeMention({ source_id: "d.md", source_title: "Delta", matched_text: "Alpha" }),
    ];
    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions") return entries;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<UnlinkedMentionsPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("Gamma")).toBeInTheDocument();
    });
    expect(screen.getByText("Delta")).toBeInTheDocument();
  });

  it("calls onCountChange with entry count when entries arrive", async () => {
    const spy = vi.fn();
    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions")
        return [makeMention(), makeMention({ source_id: "d.md" })];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<UnlinkedMentionsPanel pageId="target.md" onCountChange={spy} />);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(2);
    });
  });

  it("calls onCountChange with 0 when empty and loaded", async () => {
    const spy = vi.fn();
    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<UnlinkedMentionsPanel pageId="target.md" onCountChange={spy} />);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(0);
    });
  });

  // Cycle 10.4 — "Link" button calls IPC
  it("calls link_unlinked_mention when Link button is clicked", async () => {
    const mention = makeMention({ source_id: "c.md", source_line: 5, matched_text: "Alpha" });
    let linkCalled = false;
    let refetchCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions") {
        refetchCount++;
        if (refetchCount === 1) return [mention];
        return [];
      }
      if (cmd === "link_unlinked_mention") {
        linkCalled = true;
        return null;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<UnlinkedMentionsPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("Gamma")).toBeInTheDocument();
    });

    const linkButton = screen.getByRole("button", { name: "Link" });
    await userEvent.click(linkButton);

    expect(linkCalled).toBe(true);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("link_unlinked_mention", {
      sourceId: "c.md",
      sourceLine: 5,
      matchedText: "Alpha",
    });
  });

  // Cycle 10.5 — Title click navigates
  it("navigates to source page on title click", async () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({ selectPage });
    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions")
        return [makeMention({ source_id: "c.md", source_title: "Gamma" })];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<UnlinkedMentionsPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("Gamma")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Gamma"));

    expect(selectPage).toHaveBeenCalledWith("c.md");
  });

  // Cycle 10.6 — Highlight matched text in context
  it("highlights matched text in context", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions")
        return [makeMention({ context: "mentions Alpha in passing", matched_text: "Alpha" })];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<UnlinkedMentionsPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("Gamma")).toBeInTheDocument();
    });

    const contextEl = screen.getByTestId("unlinked-context-0");
    expect(contextEl.textContent).toBe("mentions Alpha in passing");
    const mark = contextEl.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("Alpha");
  });

  // Cycle 10.7 — Live refresh on graph-updated
  it("refetches on lit:graph-updated event", async () => {
    let callCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions") {
        callCount++;
        if (callCount === 1) return [makeMention({ source_title: "First" })];
        return [
          makeMention({ source_title: "First" }),
          makeMention({ source_id: "d.md", source_title: "Second" }),
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    render(<UnlinkedMentionsPanel pageId="target.md" />);

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

  // Cycle 11.1 — Spinner visible during initial fetch
  it("shows spinner during initial fetch, hides after resolve", async () => {
    let resolveIpc!: (value: UnlinkedMention[]) => void;
    const ipcPromise = new Promise<UnlinkedMention[]>((r) => {
      resolveIpc = r;
    });

    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions") return ipcPromise;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<UnlinkedMentionsPanel pageId="target.md" />);

    expect(screen.getByTestId("unlinked-spinner")).toBeInTheDocument();

    await act(async () => {
      resolveIpc([]);
    });

    expect(screen.queryByTestId("unlinked-spinner")).not.toBeInTheDocument();
  });

  // Cycle 11.2 — Spinner visible during refetch on graph-updated
  it("shows spinner during refetch on lit:graph-updated", async () => {
    let callCount = 0;
    let resolveSecond!: (value: UnlinkedMention[]) => void;

    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions") {
        callCount++;
        if (callCount === 1) return [makeMention({ source_title: "First" })];
        return new Promise<UnlinkedMention[]>((r) => {
          resolveSecond = r;
        });
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    render(<UnlinkedMentionsPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("First")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("unlinked-spinner")).not.toBeInTheDocument();

    act(() => {
      emitMockEvent("lit:graph-updated", {});
    });

    expect(screen.getByTestId("unlinked-spinner")).toBeInTheDocument();

    await act(async () => {
      resolveSecond([makeMention({ source_title: "First" })]);
    });

    expect(screen.queryByTestId("unlinked-spinner")).not.toBeInTheDocument();
  });

  // Cycle 11.3 — Spinner visible on pageId change
  it("shows spinner on pageId change", async () => {
    let callCount = 0;
    let resolveSecond!: (value: UnlinkedMention[]) => void;

    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions") {
        callCount++;
        if (callCount === 1) return [];
        return new Promise<UnlinkedMention[]>((r) => {
          resolveSecond = r;
        });
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { rerender } = render(<UnlinkedMentionsPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.queryByTestId("unlinked-spinner")).not.toBeInTheDocument();
    });

    rerender(<UnlinkedMentionsPanel pageId="other.md" />);

    expect(screen.getByTestId("unlinked-spinner")).toBeInTheDocument();

    await act(async () => {
      resolveSecond([]);
    });

    expect(screen.queryByTestId("unlinked-spinner")).not.toBeInTheDocument();
  });

  // Cycle 11.4 — Spinner hides on fetch error
  it("hides spinner on fetch error", async () => {
    let rejectIpc!: (reason: Error) => void;
    const ipcPromise = new Promise<UnlinkedMention[]>((_, rej) => {
      rejectIpc = rej;
    });

    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions") return ipcPromise;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<UnlinkedMentionsPanel pageId="target.md" />);

    expect(screen.getByTestId("unlinked-spinner")).toBeInTheDocument();

    await act(async () => {
      rejectIpc(new Error("fail"));
    });

    expect(screen.queryByTestId("unlinked-spinner")).not.toBeInTheDocument();
  });

  // Cycle 11.5 — Suppresses empty message during load
  it("suppresses empty message while loading, shows after resolve", async () => {
    let resolveIpc!: (value: UnlinkedMention[]) => void;
    const ipcPromise = new Promise<UnlinkedMention[]>((r) => {
      resolveIpc = r;
    });

    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions") return ipcPromise;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<UnlinkedMentionsPanel pageId="target.md" />);

    expect(screen.queryByText("No unlinked mentions found")).not.toBeInTheDocument();
    expect(screen.getByTestId("unlinked-spinner")).toBeInTheDocument();

    await act(async () => {
      resolveIpc([]);
    });

    expect(screen.getByText("No unlinked mentions found")).toBeInTheDocument();
  });

  // Cycle P1 — Accent-insensitive highlight
  it("highlights mention with accent-insensitive matching", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions")
        return [makeMention({ context: "visited the café today", matched_text: "cafe" })];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<UnlinkedMentionsPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("Gamma")).toBeInTheDocument();
    });

    const contextEl = screen.getByTestId("unlinked-context-0");
    const mark = contextEl.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("café");
  });

  describe("virtualization", () => {
    it("renders all entries when scroll container is large enough", async () => {
      const entries = Array.from({ length: 10 }, (_, i) =>
        makeMention({ source_id: `p${i}.md`, source_title: `Page ${i}`, context: `ctx ${i}` }),
      );
      mockInvoke((cmd) => {
        if (cmd === "get_unlinked_mentions") return entries;
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<UnlinkedMentionsPanel pageId="target.md" />);

      await waitFor(() => {
        expect(screen.getByText("Page 0")).toBeInTheDocument();
      });
      for (let i = 0; i < 10; i++) {
        expect(screen.getByText(`Page ${i}`)).toBeInTheDocument();
      }
    });

    it("has a scroll container with data-testid", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_unlinked_mentions") return [makeMention()];
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<UnlinkedMentionsPanel pageId="target.md" />);

      await waitFor(() => {
        expect(screen.getByText("Gamma")).toBeInTheDocument();
      });
      expect(screen.getByTestId("unlinked-scroll-container")).toBeInTheDocument();
    });

    it("spinner renders outside the virtualized list", async () => {
      let callCount = 0;
      let resolveSecond!: (value: UnlinkedMention[]) => void;

      mockInvoke((cmd) => {
        if (cmd === "get_unlinked_mentions") {
          callCount++;
          if (callCount === 1) return [makeMention({ source_title: "First" })];
          return new Promise<UnlinkedMention[]>((r) => {
            resolveSecond = r;
          });
        }
        throw new Error(`Unknown command: ${cmd}`);
      });
      mockListen();

      render(<UnlinkedMentionsPanel pageId="target.md" />);

      await waitFor(() => {
        expect(screen.getByText("First")).toBeInTheDocument();
      });

      act(() => {
        emitMockEvent("lit:graph-updated", {});
      });

      const spinner = screen.getByTestId("unlinked-spinner");
      const scrollContainer = screen.getByTestId("unlinked-scroll-container");
      expect(scrollContainer.contains(spinner)).toBe(false);

      await act(async () => {
        resolveSecond([makeMention({ source_title: "First" })]);
      });
    });
  });

  // Cycle 10.8 — Entry disappears after linking
  it("removes entry from list after linking", async () => {
    let fetchCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions") {
        fetchCount++;
        if (fetchCount === 1)
          return [
            makeMention({ source_id: "c.md", source_title: "Gamma" }),
            makeMention({ source_id: "d.md", source_title: "Delta" }),
          ];
        return [makeMention({ source_id: "d.md", source_title: "Delta" })];
      }
      if (cmd === "link_unlinked_mention") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<UnlinkedMentionsPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("Gamma")).toBeInTheDocument();
    });

    const linkButtons = screen.getAllByRole("button", { name: "Link" });
    await userEvent.click(linkButtons[0]!);

    await waitFor(() => {
      expect(screen.queryByText("Gamma")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Delta")).toBeInTheDocument();
  });
});
