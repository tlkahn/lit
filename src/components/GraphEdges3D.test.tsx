import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { GraphEdges3D } from "./GraphEdges3D";

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
}));
vi.mock("@react-three/drei", () => ({}));

describe("GraphEdges3D", () => {
  it("renders without crash with empty edges", () => {
    const { container } = render(
      <GraphEdges3D edges={[]} positions={{}} edgeColor="#818b98" opacity={0.5} />,
    );
    expect(container).toBeTruthy();
  });

  it("renders without crash with valid edges", () => {
    const edges: [string, string][] = [["a", "b"]];
    const positions = { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 1, z: 1 } };
    const { container } = render(
      <GraphEdges3D edges={edges} positions={positions} edgeColor="#818b98" opacity={0.5} />,
    );
    expect(container).toBeTruthy();
  });

  it("handles edges with missing endpoints without crash", () => {
    const edges: [string, string][] = [["a", "missing"]];
    const positions = { a: { x: 0, y: 0, z: 0 } };
    const { container } = render(
      <GraphEdges3D edges={edges} positions={positions} edgeColor="#818b98" opacity={0.5} />,
    );
    expect(container).toBeTruthy();
  });

  it("handles 100-node synthetic graph without error", () => {
    const nodes = Array.from({ length: 100 }, (_, i) => `n${i}`);
    const positions: Record<string, { x: number; y: number; z: number }> = {};
    for (const n of nodes) {
      positions[n] = { x: Math.random() * 10, y: Math.random() * 10, z: Math.random() * 10 };
    }
    const edges: [string, string][] = [];
    for (let i = 0; i < 99; i++) {
      edges.push([`n${i}`, `n${i + 1}`]);
    }
    const { container } = render(
      <GraphEdges3D edges={edges} positions={positions} edgeColor="#818b98" opacity={0.35} />,
    );
    expect(container).toBeTruthy();
  });
});
