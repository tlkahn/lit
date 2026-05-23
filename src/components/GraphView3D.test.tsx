import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GraphView3D } from "./GraphView3D";
import type { GraphView3DProps } from "./GraphView3D";
import { createRef } from "react";
import type { CameraControllerHandle } from "./CameraController";

const mockCamera = {
  position: { set: vi.fn(), x: 0, y: 0, z: 0 },
  lookAt: vi.fn(),
  fov: 75,
};

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
  useThree: () => ({ camera: mockCamera }),
}));
vi.mock("@react-three/drei", () => ({
  OrbitControls: vi.fn(() => null),
}));

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

  it("does not render the orange box stub", () => {
    const { container } = render(<GraphView3D {...defaults} />);
    expect(container.querySelector("boxGeometry")).toBeNull();
  });

  it("renders with synthetic graph data without error", () => {
    const nodes = [
      { id: "a", title: "A", is_stub: false },
      { id: "b", title: "B", is_stub: true },
      { id: "c", title: "C", is_stub: false },
    ];
    const edges: [string, string][] = [["a", "b"], ["b", "c"]];
    const positions = {
      a: { x: 0, y: 0, z: 0 },
      b: { x: 5, y: 5, z: 5 },
      c: { x: 10, y: 0, z: 0 },
    };
    const pagerank = { a: 0.5, b: 0.3, c: 0.1 };

    render(
      <GraphView3D
        nodes={nodes}
        edges={edges}
        positions={positions}
        pagerank={pagerank}
        seedId="a"
      />,
    );
    expect(screen.getByTestId("graph-view-3d")).toBeTruthy();
  });

  it("accepts onResetZoom ref without error", () => {
    const ref = createRef<CameraControllerHandle>();
    render(
      <GraphView3D
        {...defaults}
        onResetZoom={ref as React.RefObject<CameraControllerHandle | null>}
      />,
    );
    expect(screen.getByTestId("graph-view-3d")).toBeTruthy();
  });

  it("populates onResetZoom ref with CameraControllerHandle after render", () => {
    const ref = { current: null } as React.MutableRefObject<CameraControllerHandle | null>;
    render(<GraphView3D {...defaults} onResetZoom={ref} />);
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current!.resetCamera).toBe("function");
    expect(typeof ref.current!.flyTo).toBe("function");
  });

  it("accepts all optional callbacks", () => {
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
