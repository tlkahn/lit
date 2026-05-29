import { useState, useCallback, useRef, type RefObject } from "react";
import { useGraphSelectionStore } from "../stores/graphSelection";
import type { SigmaLike, GraphLike } from "./graphTypes";

export interface LassoState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export function useGraphLasso(
  containerRef: RefObject<HTMLDivElement | null>,
  sigmaRef: RefObject<Pick<SigmaLike, "setSetting" | "getNodeDisplayData" | "framedGraphToViewport"> | null>,
  graphRef: RefObject<Pick<GraphLike, "nodes"> | null>,
  hoveredNodeRef: RefObject<string | null>,
) {
  const [lassoState, setLassoState] = useState<LassoState | null>(null);
  const lassoRef = useRef<LassoState | null>(null);

  const handleLassoMouseDown = useCallback((e: React.MouseEvent) => {
    if (!e.shiftKey || hoveredNodeRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    const x = e.clientX - (rect?.left ?? 0);
    const y = e.clientY - (rect?.top ?? 0);
    const coords: LassoState = { startX: x, startY: y, currentX: x, currentY: y };
    lassoRef.current = coords;
    useGraphSelectionStore.getState().setSelectionMode("lasso");
    setLassoState(coords);
    sigmaRef.current?.setSetting("enableCameraPanning", false);
    if (containerRef.current) {
      containerRef.current.style.cursor = "crosshair";
    }
  }, []);

  const handleLassoMouseMove = useCallback((e: React.MouseEvent) => {
    if (!lassoRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    const x = e.clientX - (rect?.left ?? 0);
    const y = e.clientY - (rect?.top ?? 0);
    lassoRef.current.currentX = x;
    lassoRef.current.currentY = y;
    setLassoState((prev) => prev ? { ...prev, currentX: x, currentY: y } : null);
  }, []);

  const handleLassoMouseUp = useCallback(() => {
    if (!lassoRef.current) return;

    const prev = lassoRef.current;
    if (prev) {
      const sigma = sigmaRef.current;
      const graph = graphRef.current;
      if (sigma && graph) {
        const left = Math.min(prev.startX, prev.currentX);
        const top = Math.min(prev.startY, prev.currentY);
        const right = Math.max(prev.startX, prev.currentX);
        const bottom = Math.max(prev.startY, prev.currentY);
        const toAdd: string[] = [];
        for (const nodeId of graph.nodes()) {
          const pos = sigma.getNodeDisplayData(nodeId);
          if (!pos || pos.hidden) continue;
          const vp = sigma.framedGraphToViewport(pos);
          if (vp.x >= left && vp.x <= right && vp.y >= top && vp.y <= bottom) {
            toAdd.push(nodeId);
          }
        }
        if (toAdd.length > 0) {
          useGraphSelectionStore.getState().addNodes(toAdd);
        }
      }
    }

    lassoRef.current = null;
    setLassoState(null);
    sigmaRef.current?.setSetting("enableCameraPanning", true);
    useGraphSelectionStore.getState().setSelectionMode(useGraphSelectionStore.getState().selectedNodes.length > 0 ? "click" : "none");
    if (containerRef.current) {
      containerRef.current.style.cursor = "grab";
    }
  }, []);

  return { lassoState, handleLassoMouseDown, handleLassoMouseMove, handleLassoMouseUp };
}
