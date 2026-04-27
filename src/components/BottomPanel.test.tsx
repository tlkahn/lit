import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BottomPanel } from "./BottomPanel";
import { mockInvoke } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { usePreferencesStore } from "../stores/preferences";

beforeEach(() => {
  useWorkspaceStore.setState({
    workspacePath: "/test",
    currentPagePath: "target.md",
  });
  usePreferencesStore.setState({ experimentalUnlinkedReferences: true });
  mockInvoke((cmd) => {
    if (cmd === "get_backlinks") return [];
    if (cmd === "get_unlinked_mentions") return [];
    throw new Error(`Unknown command: ${cmd}`);
  });
});

describe("BottomPanel", () => {
  it("renders tab bar with Linked References tab", () => {
    render(<BottomPanel pageId="target.md" />);
    expect(screen.getByText("Linked References")).toBeInTheDocument();
  });

  it("renders tab bar with Unlinked References tab when flag is true", () => {
    render(<BottomPanel pageId="target.md" />);
    expect(screen.getByText("Unlinked References")).toBeInTheDocument();
  });

  it("hides Unlinked References tab when experimentalUnlinkedReferences is false", () => {
    usePreferencesStore.setState({ experimentalUnlinkedReferences: false });
    render(<BottomPanel pageId="target.md" />);
    expect(screen.queryByText("Unlinked References")).not.toBeInTheDocument();
  });

  it("starts folded — panel body not visible", () => {
    render(<BottomPanel pageId="target.md" />);
    const panel = screen.getByTestId("bottom-panel");
    expect(panel.style.height).toBe("32px");
  });

  it("click Linked tab unfolds panel and shows backlinks content", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks") return [];
      if (cmd === "get_unlinked_mentions") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<BottomPanel pageId="target.md" />);

    await userEvent.click(screen.getByText("Linked References"));

    const panel = screen.getByTestId("bottom-panel");
    expect(panel.style.height).not.toBe("32px");
    await waitFor(() => {
      expect(screen.getByText("No other pages link to this page")).toBeInTheDocument();
    });
  });

  it("click active tab folds panel", async () => {
    render(<BottomPanel pageId="target.md" />);

    await userEvent.click(screen.getByText("Linked References"));
    const panel = screen.getByTestId("bottom-panel");
    expect(panel.style.height).not.toBe("32px");

    await userEvent.click(screen.getByText("Linked References"));
    expect(panel.style.height).toBe("32px");
  });

  it("click inactive tab while unfolded switches content without folding", async () => {
    render(<BottomPanel pageId="target.md" />);

    await userEvent.click(screen.getByText("Linked References"));
    const panel = screen.getByTestId("bottom-panel");
    expect(panel.style.height).not.toBe("32px");

    await userEvent.click(screen.getByText("Unlinked References"));
    expect(panel.style.height).not.toBe("32px");
  });

  it("lit:toggle-bottom-panel event toggles fold/unfold", async () => {
    render(<BottomPanel pageId="target.md" />);
    const panel = screen.getByTestId("bottom-panel");

    expect(panel.style.height).toBe("32px");

    act(() => {
      window.dispatchEvent(new CustomEvent("lit:toggle-bottom-panel"));
    });
    expect(panel.style.height).not.toBe("32px");

    act(() => {
      window.dispatchEvent(new CustomEvent("lit:toggle-bottom-panel"));
    });
    expect(panel.style.height).toBe("32px");
  });

  it("shows linked count in tab after backlinks load", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks")
        return [
          { source_id: "a.md", source_title: "A", context: "ctx", source_line: 1 },
          { source_id: "b.md", source_title: "B", context: "ctx", source_line: 1 },
        ];
      if (cmd === "get_unlinked_mentions") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<BottomPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("Linked References (2)")).toBeInTheDocument();
    });
  });

  it("shows unlinked count in tab only after tab has been opened", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks") return [];
      if (cmd === "get_unlinked_mentions")
        return [
          { source_id: "c.md", source_title: "C", context: "ctx", source_line: 1, matched_text: "target" },
        ];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<BottomPanel pageId="target.md" />);

    expect(screen.queryByText("Unlinked References (1)")).not.toBeInTheDocument();
    expect(screen.getByText("Unlinked References")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Unlinked References"));

    await waitFor(() => {
      expect(screen.getByText("Unlinked References (1)")).toBeInTheDocument();
    });
  });

  it("does not mount UnlinkedMentionsPanel until unlinked tab is clicked (lazy)", async () => {
    let fetchCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks") return [];
      if (cmd === "get_unlinked_mentions") {
        fetchCount++;
        return [];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<BottomPanel pageId="target.md" />);

    await waitFor(() => {
      expect(screen.getByText("Linked References")).toBeInTheDocument();
    });

    // Allow any pending effects to settle
    await act(async () => {});
    expect(fetchCount).toBe(0);

    await userEvent.click(screen.getByText("Unlinked References"));
    await waitFor(() => {
      expect(fetchCount).toBeGreaterThan(0);
    });
  });

  it("shows subtle active indicator on last-active tab when folded", async () => {
    render(<BottomPanel pageId="target.md" />);

    await userEvent.click(screen.getByText("Linked References"));

    await userEvent.click(screen.getByText("Linked References"));

    const tab = screen.getByTestId("tab-linked");
    expect(tab.className).toContain("border-b");
    expect(tab.className).toContain("border-border-faint");
  });

  it("panel body has CSS transition style", () => {
    render(<BottomPanel pageId="target.md" />);
    const panel = screen.getByTestId("bottom-panel");
    expect(panel.style.transition).toContain("height");
  });

  it("clamps activeTab to linked when experimentalUnlinkedReferences turns off while on unlinked tab", async () => {
    render(<BottomPanel pageId="target.md" />);

    await userEvent.click(screen.getByText("Unlinked References"));
    const panel = screen.getByTestId("bottom-panel");
    expect(panel.style.height).not.toBe("32px");

    act(() => {
      usePreferencesStore.setState({ experimentalUnlinkedReferences: false });
    });

    expect(screen.queryByText("Unlinked References")).not.toBeInTheDocument();
    expect(panel.style.height).toBe("32px");
  });
});
