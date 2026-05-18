import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BufferStack } from "./BufferStack";
import { usePaneStore } from "../stores/panes";

beforeEach(() => {
  usePaneStore.setState({
    root: { type: "leaf", id: "p1", pagePath: null },
    focusedPaneId: "p1",
  });
});

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
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "p1", pagePath: "notes/foo.md" },
          { type: "leaf", id: "p2", pagePath: "notes/bar.md" },
          { type: "leaf", id: "p3", pagePath: "notes/baz.md" },
        ],
        sizes: [33, 34, 33],
      },
      focusedPaneId: "p1",
    });
    render(<BufferStack />);
    expect(screen.getByTestId("buffer-stack-chip")).toBeInTheDocument();
    expect(screen.getByTestId("buffer-stack-label")).toHaveTextContent("notes/foo.md");
    expect(screen.getByTestId("buffer-stack-count")).toHaveTextContent("(+2)");
  });

  it("tracks focused pane, not first pane", () => {
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "p1", pagePath: "notes/foo.md" },
          { type: "leaf", id: "p2", pagePath: "notes/bar.md" },
        ],
        sizes: [50, 50],
      },
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
});
