import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { hierarchy, tree as d3tree } from "d3-hierarchy";
import type { HeadingNode } from "../lib/headingTree";
import { buildHeadingTree } from "../lib/headingTree";
import { extractHeadings } from "../lib/headings";
import { buildNodeRects, buildGapZones, type PointNode } from "../lib/mindmapDnd";
import { useMindmapDrag } from "./useMindmapDrag";

const FONT_SIZES = [16, 15, 14, 13, 12, 11];
const NODE_WIDTH = 160;

function uniformWidths(descendants: PointNode[], w = NODE_WIDTH): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of descendants) m.set(d.data.id, w);
  return m;
}

function setupLayout(body: string) {
  const tree = buildHeadingTree(extractHeadings(body));
  const root = hierarchy(tree, (d) => (d.children.length > 0 ? d.children : undefined));
  const treeLayout = d3tree<HeadingNode>().nodeSize([44, 200]);
  treeLayout(root);
  const descendants = (root.descendants() as PointNode[]).filter((d) => d.data.level > 0);
  const nodeRects = buildNodeRects(descendants, uniformWidths(descendants), FONT_SIZES);
  const gapZones = buildGapZones(descendants);
  return { tree, descendants, nodeRects, gapZones };
}

function makeSvgRef() {
  const el = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    getAttribute: () => null,
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  } as unknown as SVGSVGElement;
  return { current: el };
}

function pointerEvent(overrides: Partial<React.PointerEvent> = {}): React.PointerEvent {
  return {
    button: 0,
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    ...overrides,
  } as React.PointerEvent;
}

describe("useMindmapDrag", () => {
  const body = "# A\n## B\n## C";
  let layout: ReturnType<typeof setupLayout>;
  let svgRef: ReturnType<typeof makeSvgRef>;
  let onNodeMove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    layout = setupLayout(body);
    svgRef = makeSvgRef();
    onNodeMove = vi.fn();
  });

  const zoomTransformRef = { current: { k: 1, x: 0, y: 0 } };

  function renderDragHook() {
    return renderHook(() =>
      useMindmapDrag({
        svgRef,
        descendants: layout.descendants,
        tree: layout.tree,
        nodeRects: layout.nodeRects,
        gapZones: layout.gapZones,
        onNodeMove,
        zoomTransformRef,
      }),
    );
  }

  it("starts in idle state", () => {
    const { result } = renderDragHook();
    expect(result.current.dragState.isDragging).toBe(false);
    expect(result.current.dragState.draggingId).toBeNull();
    expect(result.current.dragState.dropTarget).toBeNull();
  });

  it("onPointerDown sets pending source but not dragging", () => {
    const { result } = renderDragHook();
    const nodeId = layout.descendants[0]!.data.id;
    act(() => {
      result.current.handlers.onPointerDown(nodeId, pointerEvent({ clientX: 10, clientY: 10 }));
    });
    expect(result.current.dragState.isDragging).toBe(false);
  });

  it("onPointerMove past threshold sets isDragging", () => {
    const { result } = renderDragHook();
    const nodeId = layout.descendants[0]!.data.id;
    act(() => {
      result.current.handlers.onPointerDown(nodeId, pointerEvent({ clientX: 0, clientY: 0 }));
    });
    act(() => {
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 10, clientY: 10 }));
    });
    expect(result.current.dragState.isDragging).toBe(true);
    expect(result.current.dragState.draggingId).toBe(nodeId);
  });

  it("cursorPos updates during drag", () => {
    const { result } = renderDragHook();
    const nodeId = layout.descendants[0]!.data.id;
    act(() => {
      result.current.handlers.onPointerDown(nodeId, pointerEvent({ clientX: 0, clientY: 0 }));
    });
    expect(result.current.dragState.cursorPos).toBeNull();
    act(() => {
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 10, clientY: 10 }));
    });
    expect(result.current.dragState.cursorPos).not.toBeNull();
    act(() => {
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 20, clientY: 25 }));
    });
    expect(result.current.dragState.cursorPos).toEqual({ x: 20, y: 25 });
  });

  it("below threshold stays idle", () => {
    const { result } = renderDragHook();
    const nodeId = layout.descendants[0]!.data.id;
    act(() => {
      result.current.handlers.onPointerDown(nodeId, pointerEvent({ clientX: 0, clientY: 0 }));
    });
    act(() => {
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 2, clientY: 2 }));
    });
    expect(result.current.dragState.isDragging).toBe(false);
  });

  it("onPointerUp resets state", () => {
    const { result } = renderDragHook();
    const nodeId = layout.descendants[0]!.data.id;
    act(() => {
      result.current.handlers.onPointerDown(nodeId, pointerEvent({ clientX: 0, clientY: 0 }));
    });
    act(() => {
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 10, clientY: 10 }));
    });
    act(() => {
      result.current.handlers.onPointerUp(pointerEvent({ clientX: 10, clientY: 10 }));
    });
    expect(result.current.dragState.isDragging).toBe(false);
    expect(result.current.dragState.draggingId).toBeNull();
  });

  it("short click does not fire onNodeMove", () => {
    const { result } = renderDragHook();
    const nodeId = layout.descendants[0]!.data.id;
    act(() => {
      result.current.handlers.onPointerDown(nodeId, pointerEvent({ clientX: 5, clientY: 5 }));
    });
    act(() => {
      result.current.handlers.onPointerUp(pointerEvent({ clientX: 6, clientY: 6 }));
    });
    expect(onNodeMove).not.toHaveBeenCalled();
  });

  it("drop on self is a no-op", () => {
    const { result } = renderDragHook();
    const nodeB = layout.descendants.find((d) => d.data.text === "B")!;
    const rect = layout.nodeRects.find((r) => r.id === nodeB.data.id)!;

    act(() => {
      result.current.handlers.onPointerDown(nodeB.data.id, pointerEvent({ clientX: 0, clientY: 0 }));
    });
    act(() => {
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 100, clientY: 100 }));
    });
    act(() => {
      result.current.handlers.onPointerUp(
        pointerEvent({ clientX: rect.left + 10, clientY: rect.top + 5 }),
      );
    });
    expect(onNodeMove).not.toHaveBeenCalled();
  });

  it("Escape cancels drag", () => {
    const { result } = renderDragHook();
    const nodeId = layout.descendants[0]!.data.id;
    act(() => {
      result.current.handlers.onPointerDown(nodeId, pointerEvent({ clientX: 0, clientY: 0 }));
    });
    act(() => {
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 10, clientY: 10 }));
    });
    expect(result.current.dragState.isDragging).toBe(true);
    act(() => {
      result.current.handlers.onKeyDown({ key: "Escape" } as React.KeyboardEvent);
    });
    expect(result.current.dragState.isDragging).toBe(false);
    expect(result.current.dragState.draggingId).toBeNull();
  });

  it("drop on descendant is a no-op", () => {
    const deepBody = "# A\n## B\n### C";
    const deepLayout = setupLayout(deepBody);
    const deepSvgRef = makeSvgRef();
    const deepOnNodeMove = vi.fn();

    const { result } = renderHook(() =>
      useMindmapDrag({
        svgRef: deepSvgRef,
        descendants: deepLayout.descendants,
        tree: deepLayout.tree,
        nodeRects: deepLayout.nodeRects,
        gapZones: deepLayout.gapZones,
        onNodeMove: deepOnNodeMove,
        zoomTransformRef: { current: { k: 1, x: 0, y: 0 } },
      }),
    );

    const nodeA = deepLayout.descendants.find((d) => d.data.text === "A")!;
    const nodeC = deepLayout.descendants.find((d) => d.data.text === "C")!;
    const rectC = deepLayout.nodeRects.find((r) => r.id === nodeC.data.id)!;

    act(() => {
      result.current.handlers.onPointerDown(nodeA.data.id, pointerEvent({ clientX: 0, clientY: 0 }));
    });
    act(() => {
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 100, clientY: 100 }));
    });
    act(() => {
      result.current.handlers.onPointerUp(
        pointerEvent({ clientX: rectC.left + 10, clientY: rectC.top + 5 }),
      );
    });
    expect(deepOnNodeMove).not.toHaveBeenCalled();
  });
});
