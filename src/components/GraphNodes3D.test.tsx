import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { GraphNodes3D } from "./GraphNodes3D";
import { buildInstanceMatrices, buildInstanceColors } from "../lib/graph3DHelpers";

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
}));
vi.mock("@react-three/drei", () => ({}));

describe("GraphNodes3D", () => {
  const defaultProps = {
    nodes: [],
    positions: {} as Record<string, { x: number; y: number; z: number }>,
    pagerank: {} as Record<string, number>,
    accentColor: "#0969da",
    stubColor: "#818b98",
    sphereSegments: [16, 12] as [number, number],
  };

  it("renders without crash with empty nodes", () => {
    const { container } = render(<GraphNodes3D {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  it("renders without crash with valid nodes", () => {
    const props = {
      ...defaultProps,
      nodes: [
        { id: "a", title: "A", is_stub: false },
        { id: "b", title: "B", is_stub: true },
      ],
      positions: { a: { x: 1, y: 2, z: 3 }, b: { x: 4, y: 5, z: 6 } },
      pagerank: { a: 0.5, b: 0.1 },
    };
    const { container } = render(<GraphNodes3D {...props} />);
    expect(container).toBeTruthy();
  });

  it("instance count matches node count via helper length", () => {
    const nodes = [
      { id: "a", title: "A", is_stub: false },
      { id: "b", title: "B", is_stub: true },
      { id: "c", title: "C", is_stub: false },
    ];
    const matrices = buildInstanceMatrices(nodes, {}, {});
    expect(matrices.length).toBe(nodes.length * 16);

    const colors = buildInstanceColors(nodes, "#0969da", "#818b98");
    expect(colors.length).toBe(nodes.length * 3);
  });

  it("accepts external meshRef prop", () => {
    const meshRef = { current: null };
    const props = {
      ...defaultProps,
      nodes: [{ id: "a", title: "A", is_stub: false }],
      positions: { a: { x: 0, y: 0, z: 0 } },
      pagerank: { a: 0.5 },
      meshRef,
    };
    const { container } = render(<GraphNodes3D {...props} />);
    expect(container).toBeTruthy();
  });

  it("accepts different sphereSegments without error", () => {
    const props = {
      ...defaultProps,
      nodes: [{ id: "a", title: "A", is_stub: false }],
      positions: { a: { x: 0, y: 0, z: 0 } },
      pagerank: { a: 0.5 },
      sphereSegments: [4, 3] as [number, number],
    };
    const { container } = render(<GraphNodes3D {...props} />);
    expect(container).toBeTruthy();
  });
});
