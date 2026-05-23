import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { GraphInteraction3D } from "./GraphInteraction3D";
import type { GraphInteraction3DProps } from "./GraphInteraction3D";

let capturedFrameCallback: ((state: unknown, delta: number) => void) | null = null;

const mockGl = {
  domElement: {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
};

const mockPointer = { x: 0, y: 0 };

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
  useThree: () => ({
    camera: { position: { set: vi.fn(), x: 0, y: 0, z: 0 }, lookAt: vi.fn(), fov: 75 },
    gl: mockGl,
    pointer: mockPointer,
    size: { width: 800, height: 600 },
  }),
  useFrame: vi.fn((cb: (state: unknown, delta: number) => void) => {
    capturedFrameCallback = cb;
  }),
}));

vi.mock("@react-three/drei", () => ({}));

describe("GraphInteraction3D", () => {
  const defaultProps: GraphInteraction3DProps = {
    meshRef: { current: null },
    nodes: [],
    edges: [],
    positions: {},
    accentColor: "#0969da",
    stubColor: "#818b98",
    dimColor: "#d1d9e0",
    raycastStrategy: "per-frame",
    raycastThrottleMs: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    capturedFrameCallback = null;
  });

  it("renders without crash", () => {
    const { container } = render(<GraphInteraction3D {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  it("registers a useFrame callback", async () => {
    const { useFrame } = await import("@react-three/fiber");
    render(<GraphInteraction3D {...defaultProps} />);
    expect(useFrame).toHaveBeenCalled();
  });

  it("accepts onHover callback prop", () => {
    const onHover = vi.fn();
    const { container } = render(
      <GraphInteraction3D {...defaultProps} onHover={onHover} />,
    );
    expect(container).toBeTruthy();
  });

  it("accepts onNavigate callback prop", () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <GraphInteraction3D {...defaultProps} onNavigate={onNavigate} />,
    );
    expect(container).toBeTruthy();
  });

  it("accepts onContextMenu callback prop", () => {
    const onContextMenu = vi.fn();
    const { container } = render(
      <GraphInteraction3D {...defaultProps} onContextMenu={onContextMenu} />,
    );
    expect(container).toBeTruthy();
  });

  it("renders with nodes and edges (structural)", () => {
    const nodes = [
      { id: "a", title: "A", is_stub: false },
      { id: "b", title: "B", is_stub: false },
    ];
    const edges: [string, string][] = [["a", "b"]];
    const positions = { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 1, z: 1 } };
    const { container } = render(
      <GraphInteraction3D
        {...defaultProps}
        nodes={nodes}
        edges={edges}
        positions={positions}
      />,
    );
    expect(container).toBeTruthy();
  });

  it("registers pointer listeners on gl.domElement", () => {
    render(
      <GraphInteraction3D
        {...defaultProps}
        onNavigate={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );
    const addCalls = mockGl.domElement.addEventListener.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(addCalls).toContain("pointerdown");
    expect(addCalls).toContain("pointerup");
    expect(addCalls).toContain("contextmenu");
  });

  it("cleans up listeners on unmount", () => {
    const { unmount } = render(
      <GraphInteraction3D
        {...defaultProps}
        onNavigate={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );
    unmount();
    const removeCalls = mockGl.domElement.removeEventListener.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(removeCalls).toContain("pointerdown");
    expect(removeCalls).toContain("pointerup");
    expect(removeCalls).toContain("contextmenu");
  });

  it("accepts throttled raycast strategy", () => {
    const { container } = render(
      <GraphInteraction3D
        {...defaultProps}
        raycastStrategy="throttled"
        raycastThrottleMs={100}
      />,
    );
    expect(container).toBeTruthy();
  });

  it("accepts seedId prop", () => {
    const { container } = render(
      <GraphInteraction3D {...defaultProps} seedId="a" />,
    );
    expect(container).toBeTruthy();
  });

  it("frame callback runs without error when mesh is null", () => {
    render(<GraphInteraction3D {...defaultProps} />);
    expect(capturedFrameCallback).toBeTruthy();
    expect(() => capturedFrameCallback!(null, 0.016)).not.toThrow();
  });
});
