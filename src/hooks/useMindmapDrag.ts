import { useCallback, useRef, useState } from "react";
import type { HeadingNode } from "../lib/headingTree";
import {
  classifyDrag,
  svgPointFromClient,
  parseViewBox,
  resolveDropTarget,
  isDescendantOf,
  getDescendantIds,
  type PointNode,
  type NodeRect,
  type GapZone,
  type DropTarget,
  type Point,
} from "../lib/mindmapDnd";

export interface DragState {
  isDragging: boolean;
  draggingId: string | null;
  dropTarget: DropTarget | null;
  invalidIds: Set<string>;
  cursorPos: Point | null;
}

const IDLE_STATE: DragState = {
  isDragging: false,
  draggingId: null,
  dropTarget: null,
  invalidIds: new Set(),
  cursorPos: null,
};

interface UseMindmapDragParams {
  svgRef: React.RefObject<SVGSVGElement | null>;
  descendants: PointNode[];
  tree: HeadingNode;
  nodeRects: NodeRect[];
  gapZones: GapZone[];
  onNodeMove: (sourceId: string, targetParentId: string, targetIndex: number) => void;
}

export function useMindmapDrag({ svgRef, descendants, tree, nodeRects, gapZones, onNodeMove }: UseMindmapDragParams) {
  const [dragState, setDragState] = useState<DragState>(IDLE_STATE);
  const startPosRef = useRef<Point | null>(null);
  const pendingIdRef = useRef<string | null>(null);
  const dragOccurredRef = useRef(false);

  const getSvgPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      const svg = svgRef.current;
      if (!svg) return { x: clientX, y: clientY };
      const rect = svg.getBoundingClientRect();
      const vbAttr = svg.getAttribute("viewBox");
      if (!vbAttr) return { x: clientX, y: clientY };
      const viewBox = parseViewBox(vbAttr);
      return svgPointFromClient(clientX, clientY, rect, viewBox);
    },
    [svgRef],
  );

  const onPointerDown = useCallback(
    (nodeId: string, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      pendingIdRef.current = nodeId;
      startPosRef.current = getSvgPoint(e.clientX, e.clientY);
      dragOccurredRef.current = false;
    },
    [getSvgPoint],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const startPos = startPosRef.current;
      if (!startPos || !pendingIdRef.current) return;

      const currentPos = getSvgPoint(e.clientX, e.clientY);

      if (!dragOccurredRef.current) {
        if (!classifyDrag(startPos, currentPos)) return;
        dragOccurredRef.current = true;
        const draggingId = pendingIdRef.current;
        const invalidIds = getDescendantIds(draggingId, tree);
        setDragState({ isDragging: true, draggingId, dropTarget: null, invalidIds, cursorPos: currentPos });
        svgRef.current?.setPointerCapture?.(e.pointerId);
      }

      const dropTarget = resolveDropTarget(currentPos, nodeRects, gapZones);
      setDragState((prev) => ({ ...prev, dropTarget, cursorPos: currentPos }));
    },
    [getSvgPoint, tree, nodeRects, gapZones, svgRef],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      svgRef.current?.releasePointerCapture?.(e.pointerId);

      if (dragOccurredRef.current && pendingIdRef.current) {
        const sourceId = pendingIdRef.current;
        const currentPos = getSvgPoint(e.clientX, e.clientY);
        const target = resolveDropTarget(currentPos, nodeRects, gapZones);

        if (target) {
          if (target.kind === "node") {
            if (!isDescendantOf(target.nodeId, sourceId, tree) && target.nodeId !== sourceId) {
              const targetNode = descendants.find((d) => d.data.id === target.nodeId);
              const childCount = targetNode ? targetNode.data.children.length : 0;
              onNodeMove(sourceId, target.nodeId, childCount);
            }
          } else {
            if (!isDescendantOf(target.parentId, sourceId, tree)) {
              onNodeMove(sourceId, target.parentId, target.index);
            }
          }
        }
      }

      pendingIdRef.current = null;
      startPosRef.current = null;
      setDragState(IDLE_STATE);
    },
    [getSvgPoint, nodeRects, gapZones, tree, descendants, onNodeMove, svgRef],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && dragOccurredRef.current) {
        pendingIdRef.current = null;
        startPosRef.current = null;
        dragOccurredRef.current = false;
        setDragState(IDLE_STATE);
      }
    },
    [],
  );

  return {
    dragState,
    dragOccurredRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onKeyDown,
    },
  };
}
