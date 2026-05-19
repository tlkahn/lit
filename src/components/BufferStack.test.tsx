import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BufferStack } from "./BufferStack";
import { usePaneStore, collectLeaves } from "../stores/panes";

beforeEach(() => {
  usePaneStore.setState({
    root: { type: "leaf", id: "p1", pagePath: null },
    focusedPaneId: "p1",
  });
});

function twoBufferState() {
  return {
    root: {
      type: "split" as const,
      id: "s1",
      direction: "horizontal" as const,
      children: [
        { type: "leaf" as const, id: "p1", pagePath: "notes/foo.md" },
        { type: "leaf" as const, id: "p2", pagePath: "notes/bar.md" },
      ],
      sizes: [50, 50],
    },
    focusedPaneId: "p1",
  };
}

function threeBufferState() {
  return {
    root: {
      type: "split" as const,
      id: "s1",
      direction: "horizontal" as const,
      children: [
        { type: "leaf" as const, id: "p1", pagePath: "notes/foo.md" },
        { type: "leaf" as const, id: "p2", pagePath: "notes/bar.md" },
        { type: "leaf" as const, id: "p3", pagePath: "notes/baz.md" },
      ],
      sizes: [33, 34, 33],
    },
    focusedPaneId: "p1",
  };
}

function sixBufferState() {
  return {
    root: {
      type: "split" as const,
      id: "s1",
      direction: "horizontal" as const,
      children: [
        { type: "leaf" as const, id: "p1", pagePath: "notes/foo.md" },
        { type: "leaf" as const, id: "p2", pagePath: "notes/bar.md" },
        { type: "leaf" as const, id: "p3", pagePath: "notes/baz.md" },
        { type: "leaf" as const, id: "p4", pagePath: "notes/qux.md" },
        { type: "leaf" as const, id: "p5", pagePath: "notes/quux.md" },
        { type: "leaf" as const, id: "p6", pagePath: "notes/corge.md" },
      ],
      sizes: [16, 17, 17, 17, 17, 16],
    },
    focusedPaneId: "p1",
  };
}

describe("BufferStack", () => {
  it("renders nothing when all panes have null pagePath", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: null },
      focusedPaneId: "p1",
    });
    const { container } = render(<BufferStack />);
    expect(container.innerHTML).toBe("");
  });

  it("renders file name for a single buffer", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "notes/foo.md" },
      focusedPaneId: "p1",
    });
    render(<BufferStack />);
    expect(screen.getByTestId("buffer-stack-label")).toHaveTextContent("notes/foo.md");
  });

  it("has no chip chrome for a single buffer", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "notes/foo.md" },
      focusedPaneId: "p1",
    });
    render(<BufferStack />);
    expect(screen.queryByTestId("buffer-stack-chip")).toBeNull();
    expect(screen.queryByTestId("buffer-stack-count")).toBeNull();
  });

  it("renders chip with count for multiple buffers", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    expect(screen.getByTestId("buffer-stack-chip")).toBeInTheDocument();
    expect(screen.getByTestId("buffer-stack-label")).toHaveTextContent("notes/foo.md");
    expect(screen.getByTestId("buffer-stack-count")).toHaveTextContent("(+2)");
  });

  it("tracks focused pane, not first pane", () => {
    usePaneStore.setState({
      ...twoBufferState(),
      focusedPaneId: "p2",
    });
    render(<BufferStack />);
    expect(screen.getByTestId("buffer-stack-label")).toHaveTextContent("notes/bar.md");
    expect(screen.getByTestId("buffer-stack-count")).toHaveTextContent("(+1)");
  });

  it("falls back to first non-empty buffer when focused pane is empty", () => {
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "p1", pagePath: null },
          { type: "leaf", id: "p2", pagePath: "notes/bar.md" },
          { type: "leaf", id: "p3", pagePath: "notes/baz.md" },
        ],
        sizes: [33, 34, 33],
      },
      focusedPaneId: "p1",
    });
    render(<BufferStack />);
    expect(screen.getByTestId("buffer-stack-label")).toHaveTextContent("notes/bar.md");
    expect(screen.getByTestId("buffer-stack-count")).toHaveTextContent("(+1)");
  });

  it("renders single-buffer style when focused is empty and only one other has content", () => {
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "p1", pagePath: null },
          { type: "leaf", id: "p2", pagePath: "notes/bar.md" },
        ],
        sizes: [50, 50],
      },
      focusedPaneId: "p1",
    });
    render(<BufferStack />);
    expect(screen.getByTestId("buffer-stack-label")).toHaveTextContent("notes/bar.md");
    expect(screen.queryByTestId("buffer-stack-chip")).toBeNull();
    expect(screen.queryByTestId("buffer-stack-count")).toBeNull();
  });

  it("renders nothing when all panes are empty in a split", () => {
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "p1", pagePath: null },
          { type: "leaf", id: "p2", pagePath: null },
        ],
        sizes: [50, 50],
      },
      focusedPaneId: "p1",
    });
    const { container } = render(<BufferStack />);
    expect(container.innerHTML).toBe("");
  });

  // --- Cycle 1: ARIA attributes on chip ---

  it("chip has aria-haspopup='listbox'", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    expect(screen.getByTestId("buffer-stack-chip")).toHaveAttribute("aria-haspopup", "listbox");
  });

  it("chip has aria-expanded='false' when popover is closed", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    expect(screen.getByTestId("buffer-stack-chip")).toHaveAttribute("aria-expanded", "false");
  });

  // --- Cycle 2: Click chip opens popover ---

  it("click chip opens popover", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-popover")).toBeInTheDocument();
  });

  it("chip aria-expanded becomes 'true' when popover is open", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-chip")).toHaveAttribute("aria-expanded", "true");
  });

  it("popover renders via portal to document.body", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    expect(popover.parentElement).toBe(document.body);
  });

  it("popover has position fixed", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-popover").style.position).toBe("fixed");
  });

  it("popover has role='listbox'", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-popover")).toHaveAttribute("role", "listbox");
  });

  // --- Cycle 3: Popover lists all leaves ---

  it("popover shows a row for every leaf including empty panes", () => {
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "p1", pagePath: "notes/foo.md" },
          { type: "leaf", id: "p2", pagePath: null },
          { type: "leaf", id: "p3", pagePath: "notes/baz.md" },
        ],
        sizes: [33, 34, 33],
      },
      focusedPaneId: "p1",
    });
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-row-p1")).toBeInTheDocument();
    expect(screen.getByTestId("buffer-stack-row-p2")).toBeInTheDocument();
    expect(screen.getByTestId("buffer-stack-row-p3")).toBeInTheDocument();
  });

  it("rows with pagePath show the basename only", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-row-p1")).toHaveTextContent("foo.md");
    expect(screen.getByTestId("buffer-stack-row-p2")).toHaveTextContent("bar.md");
  });

  it("rows with null pagePath show '(empty)'", () => {
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "p1", pagePath: "notes/foo.md" },
          { type: "leaf", id: "p2", pagePath: null },
          { type: "leaf", id: "p3", pagePath: "notes/baz.md" },
        ],
        sizes: [33, 34, 33],
      },
      focusedPaneId: "p1",
    });
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-row-p2")).toHaveTextContent("(empty)");
  });

  it("all rows have role='option'", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-row-p1")).toHaveAttribute("role", "option");
    expect(screen.getByTestId("buffer-stack-row-p2")).toHaveAttribute("role", "option");
  });

  // --- Cycle 4: Active buffer highlight ---

  it("focused pane row has active styling", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-row-p1").className).toContain("bg-interactive-accent");
  });

  it("non-focused rows do not have active styling", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-row-p2").className).not.toContain("bg-interactive-accent");
  });

  it("focused row has aria-selected='true'", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-row-p1")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("buffer-stack-row-p2")).toHaveAttribute("aria-selected", "false");
  });

  // --- Cycle 5: Click row to focus pane ---

  it("click row changes focusedPaneId", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    fireEvent.click(screen.getByTestId("buffer-stack-row-p2"));
    expect(usePaneStore.getState().focusedPaneId).toBe("p2");
  });

  it("click row closes popover", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    fireEvent.click(screen.getByTestId("buffer-stack-row-p2"));
    expect(screen.queryByTestId("buffer-stack-popover")).toBeNull();
  });

  // --- Cycle 6: Dismiss handlers ---

  it("pressing Escape closes popover", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-popover")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("buffer-stack-popover")).toBeNull();
  });

  it("mousedown on document.body closes popover", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-popover")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("buffer-stack-popover")).toBeNull();
  });

  it("click chip again toggles popover closed", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-popover")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.queryByTestId("buffer-stack-popover")).toBeNull();
  });

  // --- Cycle 7: Close (×) button ---

  it("each row has a close button", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-close-p1")).toBeInTheDocument();
    expect(screen.getByTestId("buffer-stack-close-p2")).toBeInTheDocument();
  });

  it("click × removes pane from store", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    fireEvent.click(screen.getByTestId("buffer-stack-close-p2"));
    const leaves = collectLeaves(usePaneStore.getState().root);
    expect(leaves.find((l) => l.id === "p2")).toBeUndefined();
  });

  it("click × keeps popover open", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    fireEvent.click(screen.getByTestId("buffer-stack-close-p2"));
    expect(screen.getByTestId("buffer-stack-popover")).toBeInTheDocument();
  });

  it("click × does not propagate to row (focus stays unchanged)", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    fireEvent.click(screen.getByTestId("buffer-stack-close-p2"));
    expect(usePaneStore.getState().focusedPaneId).toBe("p1");
  });

  it("closing pane that drops count to 1 unmounts popover", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-popover")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("buffer-stack-close-p2"));
    expect(screen.queryByTestId("buffer-stack-popover")).toBeNull();
  });

  // --- Edge case tests ---

  it("single buffer renders no chip or popover", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "notes/foo.md" },
      focusedPaneId: "p1",
    });
    render(<BufferStack />);
    expect(screen.queryByTestId("buffer-stack-chip")).toBeNull();
    expect(screen.queryByTestId("buffer-stack-popover")).toBeNull();
  });

  it("4 leaves (2 open, 2 empty) shows all 4 rows with correct labels", () => {
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "p1", pagePath: "notes/foo.md" },
          { type: "leaf", id: "p2", pagePath: null },
          { type: "leaf", id: "p3", pagePath: "notes/bar.md" },
          { type: "leaf", id: "p4", pagePath: null },
        ],
        sizes: [25, 25, 25, 25],
      },
      focusedPaneId: "p1",
    });
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-row-p1")).toHaveTextContent("foo.md");
    expect(screen.getByTestId("buffer-stack-row-p2")).toHaveTextContent("(empty)");
    expect(screen.getByTestId("buffer-stack-row-p3")).toHaveTextContent("bar.md");
    expect(screen.getByTestId("buffer-stack-row-p4")).toHaveTextContent("(empty)");
  });

  it("closing the focused pane updates popover with new focus", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    fireEvent.click(screen.getByTestId("buffer-stack-close-p1"));
    const newFocused = usePaneStore.getState().focusedPaneId;
    expect(newFocused).not.toBe("p1");
    const leaves = collectLeaves(usePaneStore.getState().root);
    expect(leaves.find((l) => l.id === newFocused)).toBeDefined();
  });

  // --- Positioning re-calculation ---

  it("repositions popover after closing a pane via ×", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    // Clobber position to detect re-run
    popover.style.top = "999px";
    fireEvent.click(screen.getByTestId("buffer-stack-close-p3"));
    expect(popover.style.top).not.toBe("999px");
  });

  it("repositions popover on window resize", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    popover.style.top = "999px";
    fireEvent(window, new Event("resize"));
    expect(popover.style.top).not.toBe("999px");
  });

  it("cleans up resize listener when popover closes", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("buffer-stack-popover")).toBeNull();
    // Should not throw — listener was removed
    fireEvent(window, new Event("resize"));
  });

  // --- Cycle 9: Position labels ---

  it("popover rows show position labels for horizontal split", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-position-p1")).toHaveTextContent("left");
    expect(screen.getByTestId("buffer-stack-position-p2")).toHaveTextContent("right");
  });

  it("popover rows show composed position labels for nested splits", () => {
    usePaneStore.setState({
      root: {
        type: "split" as const,
        id: "s1",
        direction: "horizontal" as const,
        children: [
          { type: "leaf" as const, id: "p1", pagePath: "notes/foo.md" },
          {
            type: "split" as const,
            id: "s2",
            direction: "vertical" as const,
            children: [
              { type: "leaf" as const, id: "p2", pagePath: "notes/bar.md" },
              { type: "leaf" as const, id: "p3", pagePath: "notes/baz.md" },
            ],
            sizes: [50, 50],
          },
        ],
        sizes: [50, 50],
      },
      focusedPaneId: "p1",
    });
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-position-p1")).toHaveTextContent("left");
    expect(screen.getByTestId("buffer-stack-position-p2")).toHaveTextContent("top-right");
    expect(screen.getByTestId("buffer-stack-position-p3")).toHaveTextContent("bottom-right");
  });

  it("position label is grouped with filename, not a direct child of the row", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const row = screen.getByTestId("buffer-stack-row-p1");
    const posSpan = screen.getByTestId("buffer-stack-position-p1");
    expect(posSpan.parentElement).not.toBe(row);
    expect(row.contains(posSpan)).toBe(true);
  });

  it("popover rows show position labels for vertical split", () => {
    usePaneStore.setState({
      root: {
        type: "split" as const,
        id: "s1",
        direction: "vertical" as const,
        children: [
          { type: "leaf" as const, id: "p1", pagePath: "notes/foo.md" },
          { type: "leaf" as const, id: "p2", pagePath: "notes/bar.md" },
        ],
        sizes: [50, 50],
      },
      focusedPaneId: "p1",
    });
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-position-p1")).toHaveTextContent("top");
    expect(screen.getByTestId("buffer-stack-position-p2")).toHaveTextContent("bottom");
  });

  it("single-leaf root renders no position spans", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "notes/foo.md" },
      focusedPaneId: "p1",
    });
    render(<BufferStack />);
    expect(screen.queryByTestId("buffer-stack-position-p1")).toBeNull();
  });

  it("open state resets when chip disappears, so re-split does not auto-show popover", () => {
    usePaneStore.setState(twoBufferState());
    const { rerender } = render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-popover")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("buffer-stack-close-p2"));
    expect(screen.queryByTestId("buffer-stack-popover")).toBeNull();
    act(() => usePaneStore.setState(twoBufferState()));
    rerender(<BufferStack />);
    expect(screen.queryByTestId("buffer-stack-popover")).toBeNull();
    expect(screen.getByTestId("buffer-stack-chip")).toHaveAttribute("aria-expanded", "false");
  });

  // --- Cycle 10: MAX_PANES boundary ---

  it("chip shows (+5) count with 6 open buffers", () => {
    usePaneStore.setState(sixBufferState());
    render(<BufferStack />);
    expect(screen.getByTestId("buffer-stack-count")).toHaveTextContent("(+5)");
  });

  it("popover lists all 6 rows with 6 open buffers", () => {
    usePaneStore.setState(sixBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-row-p1")).toBeInTheDocument();
    expect(screen.getByTestId("buffer-stack-row-p2")).toBeInTheDocument();
    expect(screen.getByTestId("buffer-stack-row-p3")).toBeInTheDocument();
    expect(screen.getByTestId("buffer-stack-row-p4")).toBeInTheDocument();
    expect(screen.getByTestId("buffer-stack-row-p5")).toBeInTheDocument();
    expect(screen.getByTestId("buffer-stack-row-p6")).toBeInTheDocument();
  });

  // --- Cycle 11: Close button on last pane ---

  it("no close buttons remain after closing down to a single pane", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    fireEvent.click(screen.getByTestId("buffer-stack-close-p2"));
    expect(screen.queryAllByTestId(/^buffer-stack-close-/)).toHaveLength(0);
  });

  // --- Phase 5 Cycle 1: Long Filename Truncation ---

  it("chip label has title attribute with full path", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    expect(screen.getByTestId("buffer-stack-label")).toHaveAttribute("title", "notes/foo.md");
  });

  it("chip label span has truncate and max-w classes", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    const label = screen.getByTestId("buffer-stack-label");
    expect(label.className).toContain("truncate");
    expect(label.className).toContain("max-w-[200px]");
  });

  it("popover row filename span has title with full path", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-filename-p1")).toHaveAttribute("title", "notes/foo.md");
    expect(screen.getByTestId("buffer-stack-filename-p2")).toHaveAttribute("title", "notes/bar.md");
  });

  it("popover row filename span has truncation classes", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const fn = screen.getByTestId("buffer-stack-filename-p1");
    expect(fn.className).toContain("truncate");
    expect(fn.className).toContain("max-w-[200px]");
  });

  it("single-buffer label has title", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "notes/foo.md" },
      focusedPaneId: "p1",
    });
    render(<BufferStack />);
    expect(screen.getByTestId("buffer-stack-label")).toHaveAttribute("title", "notes/foo.md");
  });

  // --- Phase 5 Cycle 2: Accessibility — aria-label, id, aria-activedescendant ---

  it("chip has aria-label='Buffer list'", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    expect(screen.getByTestId("buffer-stack-chip")).toHaveAttribute("aria-label", "Buffer list");
  });

  it("each option row has id='buffer-option-{leaf.id}'", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-row-p1")).toHaveAttribute("id", "buffer-option-p1");
    expect(screen.getByTestId("buffer-stack-row-p2")).toHaveAttribute("id", "buffer-option-p2");
  });

  it("listbox has aria-activedescendant pointing to focused pane's row on open", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-popover")).toHaveAttribute("aria-activedescendant", "buffer-option-p1");
  });

  it("aria-activedescendant updates when focused pane differs", () => {
    usePaneStore.setState({ ...twoBufferState(), focusedPaneId: "p2" });
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-popover")).toHaveAttribute("aria-activedescendant", "buffer-option-p2");
  });

  // --- Phase 5 Cycle 3: Keyboard Navigation ---

  it("ArrowDown moves aria-activedescendant to next row", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    fireEvent.keyDown(popover, { key: "ArrowDown" });
    expect(popover).toHaveAttribute("aria-activedescendant", "buffer-option-p2");
  });

  it("ArrowUp moves to previous row", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    fireEvent.keyDown(popover, { key: "ArrowDown" });
    fireEvent.keyDown(popover, { key: "ArrowUp" });
    expect(popover).toHaveAttribute("aria-activedescendant", "buffer-option-p1");
  });

  it("ArrowDown wraps from last to first", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    fireEvent.keyDown(popover, { key: "ArrowDown" });
    fireEvent.keyDown(popover, { key: "ArrowDown" });
    fireEvent.keyDown(popover, { key: "ArrowDown" });
    expect(popover).toHaveAttribute("aria-activedescendant", "buffer-option-p1");
  });

  it("ArrowUp wraps from first to last", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    fireEvent.keyDown(popover, { key: "ArrowUp" });
    expect(popover).toHaveAttribute("aria-activedescendant", "buffer-option-p3");
  });

  it("Enter on highlighted row calls focusPane and closes popover", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    fireEvent.keyDown(popover, { key: "ArrowDown" });
    fireEvent.keyDown(popover, { key: "Enter" });
    expect(usePaneStore.getState().focusedPaneId).toBe("p2");
    expect(screen.queryByTestId("buffer-stack-popover")).toBeNull();
  });

  it("Escape still closes popover (keyboard nav regression)", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-popover")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("buffer-stack-popover")).toBeNull();
  });

  it("highlighted row has visual highlight class", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    fireEvent.keyDown(popover, { key: "ArrowDown" });
    expect(screen.getByTestId("buffer-stack-row-p2").className).toContain("bg-bg-hover");
  });

  it("highlight resets to focused pane's index when popover reopens", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    fireEvent.keyDown(popover, { key: "ArrowDown" });
    fireEvent.keyDown(popover, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-popover")).toHaveAttribute("aria-activedescendant", "buffer-option-p1");
  });

  // --- Phase 5 Cycle 4: Entry Animation ---

  describe("entry animation", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("popover has transition style containing opacity and transform", () => {
      usePaneStore.setState(twoBufferState());
      render(<BufferStack />);
      act(() => { fireEvent.click(screen.getByTestId("buffer-stack-chip")); });
      const popover = screen.getByTestId("buffer-stack-popover");
      expect(popover.style.transition).toContain("opacity");
      expect(popover.style.transition).toContain("transform");
    });

    it("popover starts with opacity 0 before animation frame", () => {
      usePaneStore.setState(twoBufferState());
      render(<BufferStack />);
      act(() => { fireEvent.click(screen.getByTestId("buffer-stack-chip")); });
      const popover = screen.getByTestId("buffer-stack-popover");
      expect(popover.style.opacity).toBe("0");
    });

    it("popover has opacity 1 after advancing timers", () => {
      usePaneStore.setState(twoBufferState());
      render(<BufferStack />);
      act(() => { fireEvent.click(screen.getByTestId("buffer-stack-chip")); });
      act(() => { vi.advanceTimersByTime(1); });
      const popover = screen.getByTestId("buffer-stack-popover");
      expect(popover.style.opacity).toBe("1");
    });
  });

  // --- Phase 5 Cycle 5: Focus Management ---

  it("opening popover moves activeElement to popover", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(document.activeElement).toBe(screen.getByTestId("buffer-stack-popover"));
  });

  it("Escape returns focus to chip button", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByTestId("buffer-stack-chip"));
  });

  it("click-outside returns focus to chip button", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    fireEvent.mouseDown(document.body);
    expect(document.activeElement).toBe(screen.getByTestId("buffer-stack-chip"));
  });

  it("Enter-to-select returns focus away from popover", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    fireEvent.keyDown(popover, { key: "Enter" });
    expect(screen.queryByTestId("buffer-stack-popover")).toBeNull();
    expect(document.activeElement).not.toBe(popover);
  });

  it("focus restores correctly across multiple open/close cycles", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByTestId("buffer-stack-chip"));
      expect(document.activeElement).toBe(screen.getByTestId("buffer-stack-popover"));
      fireEvent.keyDown(document, { key: "Escape" });
      expect(document.activeElement).toBe(screen.getByTestId("buffer-stack-chip"));
    }
  });

  // --- Phase 5 Cycle 6: Tab Trapping Among Close Buttons ---

  it("Tab from popover moves focus to first close button", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    fireEvent.keyDown(popover, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByTestId("buffer-stack-close-p1"));
  });

  it("Tab from last close button wraps to first", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    fireEvent.keyDown(popover, { key: "Tab" });
    const lastClose = screen.getByTestId("buffer-stack-close-p3");
    lastClose.focus();
    fireEvent.keyDown(popover, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByTestId("buffer-stack-close-p1"));
  });

  it("Shift+Tab from first close button wraps to last", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    fireEvent.keyDown(popover, { key: "Tab" });
    fireEvent.keyDown(popover, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId("buffer-stack-close-p3"));
  });

  // --- Phase 5 Cycle 7: Edge Cases & Integration ---

  it("highlighted row still has title attribute", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    fireEvent.keyDown(popover, { key: "ArrowDown" });
    expect(screen.getByTestId("buffer-stack-filename-p2")).toHaveAttribute("title", "notes/bar.md");
  });

  it("closing pane that is currently highlighted clamps highlightedIndex", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    fireEvent.keyDown(popover, { key: "ArrowDown" });
    fireEvent.keyDown(popover, { key: "ArrowDown" });
    expect(popover).toHaveAttribute("aria-activedescendant", "buffer-option-p3");
    fireEvent.click(screen.getByTestId("buffer-stack-close-p3"));
    const ad = screen.getByTestId("buffer-stack-popover").getAttribute("aria-activedescendant");
    expect(ad).not.toBe("buffer-option-p3");
    expect(ad).toMatch(/^buffer-option-p/);
  });

  it("ArrowDown after pane close does not crash", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    fireEvent.keyDown(popover, { key: "ArrowDown" });
    fireEvent.keyDown(popover, { key: "ArrowDown" });
    fireEvent.click(screen.getByTestId("buffer-stack-close-p3"));
    expect(() => {
      fireEvent.keyDown(screen.getByTestId("buffer-stack-popover"), { key: "ArrowDown" });
    }).not.toThrow();
  });

  it("six buffers: ArrowDown wraps correctly at boundary", () => {
    usePaneStore.setState(sixBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    for (let i = 0; i < 6; i++) {
      fireEvent.keyDown(popover, { key: "ArrowDown" });
    }
    expect(popover).toHaveAttribute("aria-activedescendant", "buffer-option-p1");
  });

  // --- Review fix Cycle 1: Focus restore on mount ---

  it("chip does not steal focus on initial render", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    expect(document.activeElement).not.toBe(screen.getByTestId("buffer-stack-chip"));
  });

  // --- Review fix Cycle 2: Duplicate bg-bg-hover on active+highlighted row ---

  it("active row does not get bg-bg-hover when also highlighted", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const row = screen.getByTestId("buffer-stack-row-p1");
    expect(row.className).toContain("bg-interactive-accent");
    const classes = row.className.split(/\s+/);
    expect(classes).not.toContain("bg-bg-hover");
  });

  // --- Review fix Cycle 3: Shift+Tab from popover ---

  it("Shift+Tab from popover moves focus to last close button", () => {
    usePaneStore.setState(threeBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    const popover = screen.getByTestId("buffer-stack-popover");
    fireEvent.keyDown(popover, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId("buffer-stack-close-p3"));
  });

  // --- Review fix Cycle 4: outline-none on popover ---

  it("popover has outline-none class when open", () => {
    usePaneStore.setState(twoBufferState());
    render(<BufferStack />);
    fireEvent.click(screen.getByTestId("buffer-stack-chip"));
    expect(screen.getByTestId("buffer-stack-popover").className).toContain("outline-none");
  });
});
