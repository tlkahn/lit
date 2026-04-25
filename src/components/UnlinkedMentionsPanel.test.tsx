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
  });
});

describe("UnlinkedMentionsPanel", () => {
  // Cycle 10.1 — Empty state (starts collapsed, expand to see message)
  it("shows empty message when no unlinked mentions", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<UnlinkedMentionsPanel pageId="target.md" />);

    // Wait for fetch to settle, then expand
    await waitFor(() => {
      expect(screen.getByTestId("unlinked-header")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId("unlinked-header"));

    expect(screen.getByText("No unlinked mentions found")).toBeInTheDocument();
  });

  // Cycle 10.2 — Display entries with count
  it("displays entries with count in header when expanded", async () => {
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
      expect(screen.getByText("Unlinked References (2)")).toBeInTheDocument();
    });

    // Expand to see entries
    await userEvent.click(screen.getByTestId("unlinked-header"));

    expect(screen.getByText("Gamma")).toBeInTheDocument();
    expect(screen.getByText("Delta")).toBeInTheDocument();
  });

  // Cycle 10.3 — Collapse/expand (starts collapsed)
  it("starts collapsed; click to expand; click again to collapse", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_unlinked_mentions")
        return [makeMention({ source_title: "Gamma" })];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<UnlinkedMentionsPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("Unlinked References (1)")).toBeInTheDocument();
    });

    // Starts collapsed — entry not visible
    expect(screen.queryByText("Gamma")).not.toBeInTheDocument();

    // Click to expand
    await userEvent.click(screen.getByTestId("unlinked-header"));
    expect(screen.getByText("Gamma")).toBeInTheDocument();

    // Click to collapse again
    await userEvent.click(screen.getByTestId("unlinked-header"));
    expect(screen.queryByText("Gamma")).not.toBeInTheDocument();
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
      expect(screen.getByText("Unlinked References (1)")).toBeInTheDocument();
    });

    // Expand
    await userEvent.click(screen.getByTestId("unlinked-header"));

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
      expect(screen.getByText("Unlinked References (1)")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("unlinked-header"));
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
      expect(screen.getByText("Unlinked References (1)")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("unlinked-header"));

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
      expect(screen.getByText("Unlinked References (1)")).toBeInTheDocument();
    });

    act(() => {
      emitMockEvent("lit:graph-updated", {});
    });

    await waitFor(() => {
      expect(screen.getByText("Unlinked References (2)")).toBeInTheDocument();
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
      expect(screen.getByText("Unlinked References (2)")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("unlinked-header"));
    expect(screen.getByText("Gamma")).toBeInTheDocument();

    // Click Link on the first entry
    const linkButtons = screen.getAllByRole("button", { name: "Link" });
    await userEvent.click(linkButtons[0]!);

    await waitFor(() => {
      expect(screen.getByText("Unlinked References (1)")).toBeInTheDocument();
    });
    expect(screen.queryByText("Gamma")).not.toBeInTheDocument();
    expect(screen.getByText("Delta")).toBeInTheDocument();
  });
});
