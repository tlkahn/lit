import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import { useWorkspaceStore } from "../stores/workspace";

beforeEach(() => {
  useWorkspaceStore.setState({
    workspacePath: null,
    graphReady: false,
    indexProgress: null,
  });
});

describe("StatusBar", () => {
  it("renders nothing when graphReady is true", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
    const { container } = render(<StatusBar />);
    expect(container.innerHTML).toBe("");
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
});
