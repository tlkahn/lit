import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { mockInvoke } from "../test/tauri-mock";

const mockSigmaKill = vi.fn();
const mockLayoutKill = vi.fn();
const mockSigmaOn = vi.fn();

vi.mock("sigma", () => ({
  default: class MockSigma {
    kill = mockSigmaKill;
    on = mockSigmaOn;
    constructor() {}
  },
}));

vi.mock("@sigma/node-border", () => ({
  createNodeBorderProgram: () => class MockProgram {},
}));

vi.mock("graphology-layout-forceatlas2/worker", () => ({
  default: class MockFA2 {
    start = vi.fn();
    kill = mockLayoutKill;
  },
}));

vi.mock("graphology-layout-forceatlas2", () => ({
  inferSettings: () => ({}),
}));

vi.mock("graphology-layout", () => ({
  random: { assign: vi.fn() },
}));

describe("GraphView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
            ],
            edges: [["a.md", "b.md"]],
          };
        case "get_pagerank":
          return { "a.md": 0.4, "b.md": 0.6 };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
  });

  it("renders graph-view container", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView mode="full" />);
    expect(screen.getByTestId("graph-view")).toBeTruthy();
  });

  it("full mode calls getFullSubgraph and getPagerank", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView mode="full" />);
    const { invoke } = await import("@tauri-apps/api/core");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: [], depth: 0, directed: null });
      expect(invoke).toHaveBeenCalledWith("get_pagerank", { n: null });
    });
  });

  it("local mode calls getGraphSubgraph with activePageId", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView mode="local" activePageId="a.md" />);
    const { invoke } = await import("@tauri-apps/api/core");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: ["a.md"], depth: 2, directed: null });
    });
  });

  it("shows loading state while fetching", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView mode="full" />);
    expect(screen.getByTestId("graph-loading")).toBeTruthy();
  });

  it("calls sigma.kill and layout.kill on unmount", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { unmount } = render(<GraphView mode="full" />);
    await waitFor(() => {
      expect(mockSigmaKill).not.toHaveBeenCalled();
    });
    unmount();
    expect(mockSigmaKill).toHaveBeenCalled();
    expect(mockLayoutKill).toHaveBeenCalled();
  });

  it("shows error state when IPC fails", async () => {
    mockInvoke(() => {
      throw new Error("IPC failure");
    });
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView mode="full" />);
    await waitFor(() => {
      expect(screen.getByTestId("graph-error")).toBeTruthy();
    });
    expect(screen.getByTestId("graph-error").textContent).toBe("IPC failure");
  });

  it("canvas container fills parent via absolute positioning", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView mode="full" />);
    const canvas = screen.getByTestId("graph-canvas");
    expect(canvas.style.position).toBe("absolute");
    expect(canvas.style.inset).toBe("0");
  });

  it("loading overlay and canvas container coexist as siblings", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView mode="full" />);
    const graphView = screen.getByTestId("graph-view");
    const loading = screen.getByTestId("graph-loading");
    const canvas = screen.getByTestId("graph-canvas");
    expect(loading.parentElement).toBe(graphView);
    expect(canvas.parentElement).toBe(graphView);
  });

  it("error overlay is inside graph-view container (not replacing it)", async () => {
    mockInvoke(() => { throw new Error("IPC failure"); });
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView mode="full" />);
    await waitFor(() => {
      expect(screen.getByTestId("graph-error")).toBeTruthy();
    });
    expect(screen.getByTestId("graph-view")).toBeTruthy();
    expect(screen.getByTestId("graph-error").closest("[data-testid='graph-view']")).toBeTruthy();
  });

  it("does not re-initialize sigma when onNavigate reference changes", async () => {
    const GraphView = (await import("./GraphView")).default;
    const onNav1 = vi.fn();
    const { rerender } = render(<GraphView mode="full" onNavigate={onNav1} />);
    await waitFor(() => {
      expect(mockSigmaOn).toHaveBeenCalled();
    });
    mockSigmaKill.mockClear();
    mockSigmaOn.mockClear();

    const onNav2 = vi.fn();
    await act(async () => {
      rerender(<GraphView mode="full" onNavigate={onNav2} />);
    });

    expect(mockSigmaKill).not.toHaveBeenCalled();
  });

  it("calls the latest onNavigate after rerender", async () => {
    const GraphView = (await import("./GraphView")).default;
    const onNav1 = vi.fn();
    const { rerender } = render(<GraphView mode="full" onNavigate={onNav1} />);
    await waitFor(() => {
      expect(mockSigmaOn).toHaveBeenCalled();
    });

    const onNav2 = vi.fn();
    await act(async () => {
      rerender(<GraphView mode="full" onNavigate={onNav2} />);
    });

    const clickNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "clickNode",
    )?.[1];
    expect(clickNodeHandler).toBeDefined();
    clickNodeHandler!({ node: "a.md" });

    expect(onNav2).toHaveBeenCalledWith("a.md");
    expect(onNav1).not.toHaveBeenCalled();
  });
});
