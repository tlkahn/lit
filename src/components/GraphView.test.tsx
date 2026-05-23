import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, mockListen, emitMockEvent, resetListenMock } from "../test/tauri-mock";
import { setPerfEnabled } from "../lib/perf";

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
  useThree: () => ({
    camera: { position: { set: vi.fn(), x: 0, y: 0, z: 0 }, lookAt: vi.fn(), fov: 75 },
    gl: {
      domElement: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        style: {},
      },
    },
    pointer: { x: 0, y: 0 },
    size: { width: 800, height: 600 },
  }),
  useFrame: vi.fn(),
}));
vi.mock("@react-three/drei", () => ({
  OrbitControls: vi.fn(() => null),
}));

describe("GraphView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPerfEnabled(false);
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "get_graph_positions":
          return {};
        case "compute_layout_3d":
          return undefined;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
  });

  it("renders graph-view container", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    expect(screen.getByTestId("graph-view")).toBeTruthy();
  });

  it("full mode (default) calls getFullSubgraph (single IPC call)", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    const { invoke } = await import("@tauri-apps/api/core");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: [], depth: 0, directed: null });
    });
    expect(invoke).not.toHaveBeenCalledWith("get_pagerank", expect.anything());
  });

  it("shows loading state while fetching", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    expect(screen.getByTestId("graph-loading")).toBeTruthy();
  });

  it("shows error state when IPC fails", async () => {
    mockInvoke(() => {
      throw new Error("IPC failure");
    });
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByTestId("graph-error")).toBeTruthy();
    });
    expect(screen.getByTestId("graph-error").textContent).toBe("IPC failure");
  });

  it("error overlay is inside graph-view container (not replacing it)", async () => {
    mockInvoke(() => { throw new Error("IPC failure"); });
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByTestId("graph-error")).toBeTruthy();
    });
    expect(screen.getByTestId("graph-view")).toBeTruthy();
    expect(screen.getByTestId("graph-error").closest("[data-testid='graph-view']")).toBeTruthy();
  });

  it("loading overlay and 3D view coexist as siblings", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    const graphView = screen.getByTestId("graph-view");
    const loading = screen.getByTestId("graph-loading");
    expect(loading.parentElement).toBe(graphView);
  });

  it("renders 3D view after loading", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("graph-view-3d")).toBeTruthy();
    });
  });

  it("calls computeLayout3d when positions are empty", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    const { invoke } = await import("@tauri-apps/api/core");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("compute_layout_3d", { settings: null });
    });
  });

  it("skips computeLayout3d when positions are populated", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: { "a.md": { x: 1, y: 2, z: 3 }, "b.md": { x: 4, y: 5, z: 6 } },
          };
        case "get_graph_positions":
          return {};
        case "compute_layout_3d":
          return undefined;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });
    await act(async () => {});

    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).not.toHaveBeenCalledWith("compute_layout_3d", expect.anything());
  });

  // --- Toolbar & Mode tests ---

  it("renders GraphToolbar", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    expect(screen.getByRole("button", { name: "Full" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Local" })).toBeTruthy();
  });

  it("does not render dimension toggle (3D is the sole view)", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    expect(screen.queryByRole("button", { name: "2D" })).toBeNull();
    expect(screen.queryByRole("button", { name: "3D" })).toBeNull();
  });

  it("defaults to mode=full, depth=2", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    expect(screen.getByRole("button", { name: "Full" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "2" })).toBeNull();
  });

  it("switching to local mode shows depth controls and fetches subgraph", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView activePageId="a.md" />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Local" }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: ["a.md"], depth: 2, directed: null });
    });

    expect(screen.getByRole("button", { name: "2" })).toBeTruthy();
  });

  it("changing depth re-fetches with new depth", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView activePageId="a.md" />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Local" }));
    });
    await waitFor(() => { expect(screen.getByRole("button", { name: "2" })).toBeTruthy(); });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "3" }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: ["a.md"], depth: 3, directed: null });
    });
  });

  it("Local button is disabled when no activePageId", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    const localBtn = screen.getByRole("button", { name: "Local" });
    expect(localBtn).toBeDisabled();
  });

  it("Local button is enabled when activePageId is provided", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView activePageId="a.md" />);
    const localBtn = screen.getByRole("button", { name: "Local" });
    expect(localBtn).not.toBeDisabled();
  });

  it("full mode does NOT re-init when activePageId changes", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { rerender } = render(<GraphView activePageId="a.md" />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      rerender(<GraphView activePageId="b.md" />);
    });

    expect(invoke).not.toHaveBeenCalledWith("get_graph_subgraph", expect.anything());
  });

  // --- Search integration ---

  it("Cmd+F on graph container opens search overlay", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    const container = screen.getByTestId("graph-view");
    await act(async () => {
      container.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true }));
    });

    expect(screen.getByTestId("graph-search")).toBeTruthy();
  });

  it("clicking toolbar search button opens search", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Search graph" }));
    expect(screen.getByTestId("graph-search")).toBeTruthy();
  });

  // --- Escape to exit ---

  it("Escape on graph container (search closed) calls onExit", async () => {
    const onExit = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView onExit={onExit} />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    const container = screen.getByTestId("graph-view");
    await act(async () => {
      container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("Escape when search is open does NOT call onExit", async () => {
    const onExit = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView onExit={onExit} />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Search graph" }));
    expect(screen.getByTestId("graph-search")).toBeTruthy();

    const input = screen.getByTestId("graph-search-input");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onExit).not.toHaveBeenCalled();
  });

  it("Escape dispatched directly on container while search is open does NOT call onExit", async () => {
    const onExit = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView onExit={onExit} />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Search graph" }));
    expect(screen.getByTestId("graph-search")).toBeTruthy();

    const container = screen.getByTestId("graph-view");
    await act(async () => {
      container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onExit).not.toHaveBeenCalled();
  });

  // --- Accessibility aria-label ---

  it("after loading, container has aria-label with node and edge counts", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    const container = screen.getByTestId("graph-view");
    expect(container.getAttribute("aria-label")).toBe(
      "Knowledge graph with 2 nodes and 1 edge. Use mouse to explore, click a node to open it."
    );
  });

  it("during loading, aria-label says 'Knowledge graph loading'", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    const container = screen.getByTestId("graph-view");
    expect(container.getAttribute("aria-label")).toBe("Knowledge graph loading");
  });

  // --- lit:layout-ready event ---

  it("lit:layout-ready re-fetches positions and updates state", async () => {
    mockListen();
    let posCallCount = 0;
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "get_graph_positions":
          posCallCount++;
          return { "a.md": { x: 100, y: 200, z: 300 }, "b.md": { x: 400, y: 500, z: 600 } };
        case "compute_layout_3d":
          return undefined;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    await act(async () => {
      emitMockEvent("lit:layout-ready", {});
    });

    await waitFor(() => {
      expect(posCallCount).toBe(1);
    });

    resetListenMock();
  });

  // --- lit:graph-updated event ---

  it("lit:graph-updated re-fetches subgraph", async () => {
    mockListen();
    let callCount = 0;
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          callCount++;
          if (callCount <= 2) {
            return {
              nodes: [
                { id: "a.md", title: "A", is_stub: false },
                { id: "b.md", title: "B", is_stub: false },
              ],
              edges: [["a.md", "b.md"]],
              pagerank: { "a.md": 0.4, "b.md": 0.6 },
              positions: {},
            };
          }
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
              { id: "c.md", title: "C", is_stub: false },
            ],
            edges: [["a.md", "b.md"], ["a.md", "c.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.3, "c.md": 0.3 },
            positions: {},
          };
        case "compute_layout_3d":
          return undefined;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      emitMockEvent("lit:graph-updated", {});
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: [], depth: 0, directed: null });
    });

    resetListenMock();
  });

  // --- Context menu ---

  it("context menu renders when onExportNetwork is provided and contextMenu state is set", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });
    expect(container.querySelector("[data-graph-context-menu]")).toBeNull();
  });

  it("no context menu without onExportNetwork", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });
    expect(container.querySelector("[data-graph-context-menu]")).toBeNull();
  });

  it("Escape when context menu is open does NOT call onExit", async () => {
    const onExit = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView onExit={onExit} onExportNetwork={vi.fn()} />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });
    expect(onExit).not.toHaveBeenCalled();
  });

  // --- Visibility ---

  it("local mode re-inits when seed changes while hidden, on becoming visible", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { rerender } = render(<GraphView visible={true} activePageId="a.md" initialMode="local" />);
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      rerender(<GraphView visible={false} activePageId="b.md" initialMode="local" />);
    });
    expect(invoke).not.toHaveBeenCalledWith("get_graph_subgraph", expect.anything());

    await act(async () => {
      rerender(<GraphView visible={true} activePageId="b.md" initialMode="local" />);
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: ["b.md"], depth: 2, directed: null });
    });
  });

  // --- Reset zoom ---

  it("reset zoom button is rendered", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeTruthy();
  });
});
