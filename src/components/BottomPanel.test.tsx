import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
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

  describe("drag resize", () => {
    function mockParentBoundingRect(panel: HTMLElement, height: number) {
      const parent = panel.parentElement!;
      parent.getBoundingClientRect = () =>
        ({
          x: 0,
          y: 0,
          width: 800,
          height,
          top: 0,
          right: 800,
          bottom: height,
          left: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    }

    describe("localStorage persistence", () => {
      it("restores height from localStorage on mount", async () => {
        localStorage.setItem("lit-bottom-panel-height", "350");
        render(<BottomPanel pageId="target.md" />);
        await userEvent.click(screen.getByText("Linked References"));
        const panel = screen.getByTestId("bottom-panel");
        expect(panel.style.height).toBe("350px");
      });

      it("uses DEFAULT_PANEL_HEIGHT when localStorage is empty", async () => {
        render(<BottomPanel pageId="target.md" />);
        await userEvent.click(screen.getByText("Linked References"));
        const panel = screen.getByTestId("bottom-panel");
        expect(panel.style.height).toBe("200px");
      });

      it("ignores invalid localStorage values, falls back to default", async () => {
        localStorage.setItem("lit-bottom-panel-height", "not-a-number");
        render(<BottomPanel pageId="target.md" />);
        await userEvent.click(screen.getByText("Linked References"));
        const panel = screen.getByTestId("bottom-panel");
        expect(panel.style.height).toBe("200px");
      });

      it("clamps restored value to min 100px", async () => {
        localStorage.setItem("lit-bottom-panel-height", "50");
        render(<BottomPanel pageId="target.md" />);
        await userEvent.click(screen.getByText("Linked References"));
        const panel = screen.getByTestId("bottom-panel");
        expect(panel.style.height).toBe("100px");
      });
    });

    describe("resize handle", () => {
      it("exists with data-testid", () => {
        render(<BottomPanel pageId="target.md" />);
        expect(screen.getByTestId("resize-handle")).toBeInTheDocument();
      });

      it("has cursor ns-resize", () => {
        render(<BottomPanel pageId="target.md" />);
        const handle = screen.getByTestId("resize-handle");
        expect(handle.style.cursor).toBe("ns-resize");
      });

      it("is 4px tall", () => {
        render(<BottomPanel pageId="target.md" />);
        const handle = screen.getByTestId("resize-handle");
        expect(handle.style.height).toBe("4px");
      });
    });

    describe("core drag", () => {
      it("drag up increases height", async () => {
        render(<BottomPanel pageId="target.md" />);
        await userEvent.click(screen.getByText("Linked References"));
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseMove(document, { clientY: 400 });
        });
        expect(panel.style.height).toBe("300px");
      });

      it("clamps to min 100px", async () => {
        render(<BottomPanel pageId="target.md" />);
        await userEvent.click(screen.getByText("Linked References"));
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseMove(document, { clientY: 700 });
        });
        expect(panel.style.height).toBe("100px");
      });

      it("clamps to 60% of parent", async () => {
        render(<BottomPanel pageId="target.md" />);
        await userEvent.click(screen.getByText("Linked References"));
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 500);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseMove(document, { clientY: 100 });
        });
        expect(panel.style.height).toBe("300px");
      });

      it("persists final height to localStorage on mouseup", async () => {
        render(<BottomPanel pageId="target.md" />);
        await userEvent.click(screen.getByText("Linked References"));
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseMove(document, { clientY: 400 });
          fireEvent.mouseUp(document);
        });
        expect(localStorage.getItem("lit-bottom-panel-height")).toBe("300");
      });

      it("does not drag when panel is folded", () => {
        render(<BottomPanel pageId="target.md" />);
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseMove(document, { clientY: 400 });
        });
        expect(panel.style.height).toBe("32px");
      });

      it("multiple mousemove events update height continuously", async () => {
        render(<BottomPanel pageId="target.md" />);
        await userEvent.click(screen.getByText("Linked References"));
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
        });
        act(() => {
          fireEvent.mouseMove(document, { clientY: 450 });
        });
        expect(panel.style.height).toBe("250px");
        act(() => {
          fireEvent.mouseMove(document, { clientY: 400 });
        });
        expect(panel.style.height).toBe("300px");
        act(() => {
          fireEvent.mouseMove(document, { clientY: 350 });
        });
        expect(panel.style.height).toBe("350px");
      });
    });

    describe("transition during drag", () => {
      it("disables transition during drag and restores after", async () => {
        render(<BottomPanel pageId="target.md" />);
        await userEvent.click(screen.getByText("Linked References"));
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        expect(panel.style.transition).toBe("height 150ms ease-out");

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
        });
        expect(panel.style.transition).toBe("none");

        act(() => {
          fireEvent.mouseUp(document);
        });
        expect(panel.style.transition).toBe("height 150ms ease-out");
      });
    });

    describe("user-select during drag", () => {
      it("sets body user-select to none during drag and clears after", async () => {
        render(<BottomPanel pageId="target.md" />);
        await userEvent.click(screen.getByText("Linked References"));
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
        });
        expect(document.body.style.userSelect).toBe("none");

        act(() => {
          fireEvent.mouseUp(document);
        });
        expect(document.body.style.userSelect).toBe("");
      });
    });

    describe("window resize re-clamp", () => {
      it("re-clamps height when window resizes and parent shrinks", async () => {
        localStorage.setItem("lit-bottom-panel-height", "400");
        render(<BottomPanel pageId="target.md" />);
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        await userEvent.click(screen.getByText("Linked References"));
        expect(panel.style.height).toBe("400px");

        mockParentBoundingRect(panel, 500);
        act(() => {
          window.dispatchEvent(new Event("resize"));
        });
        expect(panel.style.height).toBe("300px");
      });

      it("does NOT re-clamp when folded", () => {
        localStorage.setItem("lit-bottom-panel-height", "400");
        render(<BottomPanel pageId="target.md" />);
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 300);

        act(() => {
          window.dispatchEvent(new Event("resize"));
        });
        expect(panel.style.height).toBe("32px");
        expect(localStorage.getItem("lit-bottom-panel-height")).toBe("400");
      });

      it("persists re-clamped height to localStorage", async () => {
        localStorage.setItem("lit-bottom-panel-height", "400");
        render(<BottomPanel pageId="target.md" />);
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        await userEvent.click(screen.getByText("Linked References"));

        mockParentBoundingRect(panel, 500);
        act(() => {
          window.dispatchEvent(new Event("resize"));
        });
        expect(localStorage.getItem("lit-bottom-panel-height")).toBe("300");
      });

      it("clamps on unfold if stored height exceeds current 60% max", async () => {
        localStorage.setItem("lit-bottom-panel-height", "400");
        render(<BottomPanel pageId="target.md" />);
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 500);

        await userEvent.click(screen.getByText("Linked References"));
        expect(panel.style.height).toBe("300px");
      });
    });

    describe("edge cases", () => {
      it("drag on handle does not trigger tab fold/unfold", async () => {
        render(<BottomPanel pageId="target.md" />);
        await userEvent.click(screen.getByText("Linked References"));
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        expect(panel.style.height).toBe("200px");

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseUp(document);
        });
        expect(panel.style.height).not.toBe("32px");
      });

      it("content area div height updates with panelHeight", async () => {
        render(<BottomPanel pageId="target.md" />);
        await userEvent.click(screen.getByText("Linked References"));
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const contentArea = panel.children[1] as HTMLElement;
        expect(contentArea.style.height).toBe("168px");

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseMove(document, { clientY: 400 });
          fireEvent.mouseUp(document);
        });
        expect(contentArea.style.height).toBe("268px");
      });

      it("unmount during drag does not throw", async () => {
        const { unmount } = render(<BottomPanel pageId="target.md" />);
        await userEvent.click(screen.getByText("Linked References"));
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseMove(document, { clientY: 400 });
        });

        expect(() => unmount()).not.toThrow();
      });
    });
  });

  describe("ARIA attributes", () => {
    it("tab bar container has role=tablist", () => {
      render(<BottomPanel pageId="target.md" />);
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });

    it("tab buttons have role=tab", () => {
      render(<BottomPanel pageId="target.md" />);
      const tabs = screen.getAllByRole("tab");
      expect(tabs.length).toBe(2);
    });

    it("panel body has role=tabpanel when unfolded", async () => {
      render(<BottomPanel pageId="target.md" />);
      await userEvent.click(screen.getByText("Linked References"));
      expect(screen.getByRole("tabpanel")).toBeInTheDocument();
    });

    it("tabs have correct IDs", () => {
      render(<BottomPanel pageId="target.md" />);
      expect(screen.getByTestId("tab-linked").id).toBe("bp-tab-linked");
      expect(screen.getByTestId("tab-unlinked").id).toBe("bp-tab-unlinked");
    });

    it("active tab when unfolded has aria-selected=true, inactive has false", async () => {
      render(<BottomPanel pageId="target.md" />);
      await userEvent.click(screen.getByText("Linked References"));

      expect(screen.getByTestId("tab-linked")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("tab-unlinked")).toHaveAttribute("aria-selected", "false");
    });

    it("when folded, all tabs have aria-selected=false", () => {
      render(<BottomPanel pageId="target.md" />);
      expect(screen.getByTestId("tab-linked")).toHaveAttribute("aria-selected", "false");
      expect(screen.getByTestId("tab-unlinked")).toHaveAttribute("aria-selected", "false");
    });

    it("tabs have aria-controls pointing to panel body id", () => {
      render(<BottomPanel pageId="target.md" />);
      expect(screen.getByTestId("tab-linked")).toHaveAttribute("aria-controls", "bp-tabpanel");
      expect(screen.getByTestId("tab-unlinked")).toHaveAttribute("aria-controls", "bp-tabpanel");
    });

    it("panel body aria-labelledby points to active tab id", async () => {
      render(<BottomPanel pageId="target.md" />);
      await userEvent.click(screen.getByText("Linked References"));
      const panel = screen.getByRole("tabpanel");
      expect(panel).toHaveAttribute("aria-labelledby", "bp-tab-linked");
    });

    it("switching tabs updates aria-labelledby", async () => {
      render(<BottomPanel pageId="target.md" />);
      await userEvent.click(screen.getByText("Linked References"));
      await userEvent.click(screen.getByText("Unlinked References"));
      const panel = screen.getByRole("tabpanel");
      expect(panel).toHaveAttribute("aria-labelledby", "bp-tab-unlinked");
    });
  });

  describe("scroll isolation", () => {
    const backlinkEntry = { source_id: "a.md", source_title: "A", context: "ctx", source_line: 1 };
    const unlinkedEntry = { source_id: "b.md", source_title: "B", context: "ctx", source_line: 1, matched_text: "target" };

    it("each panel has its own scroll container", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_backlinks") return [backlinkEntry];
        if (cmd === "get_unlinked_mentions") return [unlinkedEntry];
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<BottomPanel pageId="target.md" />);

      await userEvent.click(screen.getByText("Linked References"));
      await waitFor(() => {
        expect(screen.getByTestId("backlinks-scroll-container")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("Unlinked References"));
      await waitFor(() => {
        expect(screen.getByTestId("unlinked-scroll-container")).toBeInTheDocument();
      });
    });

    it("tabpanel div does not scroll itself", async () => {
      render(<BottomPanel pageId="target.md" />);
      await userEvent.click(screen.getByText("Linked References"));

      const tabpanel = screen.getByRole("tabpanel");
      expect(tabpanel.className).toContain("overflow-hidden");
      expect(tabpanel.className).not.toContain("overflow-y-auto");
    });

    it("passes contentHeight to panels based on panelHeight minus tab bar", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_backlinks") return [backlinkEntry];
        if (cmd === "get_unlinked_mentions") return [];
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<BottomPanel pageId="target.md" />);
      await userEvent.click(screen.getByText("Linked References"));

      await waitFor(() => {
        const scrollContainer = screen.getByTestId("backlinks-scroll-container");
        // Default panelHeight is 200, TAB_BAR_HEIGHT is 32, so contentHeight = 168
        expect(scrollContainer.style.height).toBe("168px");
      });
    });
  });

  describe("focus management", () => {
    it("opening via toggle event does not steal focus", () => {
      render(<BottomPanel pageId="target.md" />);
      const dummy = document.createElement("input");
      document.body.appendChild(dummy);
      dummy.focus();
      expect(document.activeElement).toBe(dummy);

      act(() => {
        window.dispatchEvent(new CustomEvent("lit:toggle-bottom-panel"));
      });

      expect(document.activeElement).toBe(dummy);
      document.body.removeChild(dummy);
    });

    it("keyboard close dispatches lit:request-editor-focus", async () => {
      render(<BottomPanel pageId="target.md" />);
      const spy = vi.fn();
      window.addEventListener("lit:request-editor-focus", spy);

      act(() => {
        window.dispatchEvent(new CustomEvent("lit:toggle-bottom-panel"));
      });

      act(() => {
        window.dispatchEvent(new CustomEvent("lit:toggle-bottom-panel"));
      });

      await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      window.removeEventListener("lit:request-editor-focus", spy);
    });

    it("click-to-fold does NOT dispatch lit:request-editor-focus", async () => {
      render(<BottomPanel pageId="target.md" />);
      const spy = vi.fn();
      window.addEventListener("lit:request-editor-focus", spy);

      await userEvent.click(screen.getByText("Linked References"));
      await userEvent.click(screen.getByText("Linked References"));

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(spy).not.toHaveBeenCalled();
      window.removeEventListener("lit:request-editor-focus", spy);
    });
  });
});
