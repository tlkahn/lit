import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import { useWorkspaceStore } from "../stores/workspace";
import { usePaneStore } from "../stores/panes";
import { useCursorInfoStore } from "../stores/cursorInfo";

beforeEach(() => {
  useWorkspaceStore.setState({
    workspacePath: null,
    graphReady: false,
    indexProgress: null,
  });
  usePaneStore.setState({
    root: { type: "leaf", id: "p1", pagePath: null },
    focusedPaneId: "p1",
  });
  useCursorInfoStore.setState({ line: 0, col: 0 });
});

describe("StatusBar", () => {
  it("renders status bar with no buffer label when graphReady but no pagePath", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: null },
      focusedPaneId: "p1",
    });
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("buffer-stack-label")).toBeNull();
  });

  it("renders nothing when workspacePath is null", () => {
    useWorkspaceStore.setState({ workspacePath: null, graphReady: false });
    const { container } = render(<StatusBar />);
    expect(container.innerHTML).toBe("");
  });

  it("shows status bar when graphReady is false and workspacePath is set", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", graphReady: false });
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar")).toBeInTheDocument();
  });

  it("shows phase label from indexProgress", () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      graphReady: false,
      indexProgress: { phase: "parsing", current: 3, total: 10 },
    });
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar")).toHaveTextContent("Parsing pages...");
  });

  it("shows Initializing when indexProgress is null", () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      graphReady: false,
      indexProgress: null,
    });
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar")).toHaveTextContent("Initializing...");
  });

  it("shows progress bar with correct width", () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      graphReady: false,
      indexProgress: { phase: "parsing", current: 3, total: 10 },
    });
    render(<StatusBar />);
    const fill = screen.getByTestId("status-bar-fill");
    expect(fill.style.width).toBe("30%");
  });

  it("shows animate-pulse when total is 0", () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      graphReady: false,
      indexProgress: { phase: "building", current: 0, total: 0 },
    });
    render(<StatusBar />);
    const fill = screen.getByTestId("status-bar-fill");
    expect(fill.className).toContain("animate-pulse");
  });

  it("shows file path via BufferStack when graphReady and pane has pagePath", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
      focusedPaneId: "p1",
    });
    render(<StatusBar />);
    expect(screen.getByTestId("buffer-stack-label")).toHaveTextContent("notes/hello.md");
  });

  it("shows cursor position Ln X, Col Y", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
      focusedPaneId: "p1",
    });
    useCursorInfoStore.setState({ line: 5, col: 10 });
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar-cursor")).toHaveTextContent("Ln 5, Col 10");
  });

  it("hides cursor position when line is 0", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
      focusedPaneId: "p1",
    });
    useCursorInfoStore.setState({ line: 0, col: 0 });
    render(<StatusBar />);
    expect(screen.getByTestId("buffer-stack-label")).toBeInTheDocument();
    expect(screen.queryByTestId("status-bar-cursor")).toBeNull();
  });

  it("still shows indexing progress when graphReady is false", () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      graphReady: false,
      indexProgress: { phase: "scanning", current: 1, total: 5 },
    });
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar")).toHaveTextContent("Scanning files...");
  });

  it("shows buffer chip with count for multiple open panes", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
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
      focusedPaneId: "p1",
    });
    render(<StatusBar />);
    expect(screen.getByTestId("buffer-stack-chip")).toBeInTheDocument();
    expect(screen.getByTestId("buffer-stack-count")).toHaveTextContent("(+1)");
  });
});
