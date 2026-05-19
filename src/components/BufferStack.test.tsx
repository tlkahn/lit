import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
});
