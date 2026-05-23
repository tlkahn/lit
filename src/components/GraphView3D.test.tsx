import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GraphView3D } from "./GraphView3D";
import type { GraphView3DProps } from "./GraphView3D";

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
}));
vi.mock("@react-three/drei", () => ({}));

describe("GraphView3D", () => {
  const defaults: GraphView3DProps = {
    nodes: [],
    edges: [],
    positions: {},
    pagerank: {},
  };

  it("renders a container with data-testid='graph-view-3d'", () => {
    render(<GraphView3D {...defaults} />);
    expect(screen.getByTestId("graph-view-3d")).toBeTruthy();
  });

  it("contains an R3F Canvas element", () => {
    render(<GraphView3D {...defaults} />);
    expect(screen.getByTestId("r3f-canvas")).toBeTruthy();
  });

  it("accepts GraphView3DProps with all optional callbacks", () => {
    const ref = { current: null };
    render(
      <GraphView3D
        {...defaults}
        nodes={[{ id: "a", title: "A", is_stub: false }]}
        edges={[["a", "b"]]}
        positions={{ a: { x: 0, y: 0, z: 0 } }}
        pagerank={{ a: 0.5 }}
        seedId="a"
        onNavigate={vi.fn()}
        onHover={vi.fn()}
        onContextMenu={vi.fn()}
        onResetZoom={ref}
      />,
    );
    expect(screen.getByTestId("graph-view-3d")).toBeTruthy();
  });
});
