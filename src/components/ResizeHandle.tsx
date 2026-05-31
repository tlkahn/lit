import { useEffect, useRef, type RefObject } from "react";
import { MIN_PANEL_HEIGHT, MIN_PANEL_WIDTH } from "../stores/bottomPanel";

type Direction = "bottom" | "left" | "right";

export interface ResizeConfig {
  axis: "x" | "y";
  cursor: string;
  deltaSign: number;
  maxRatio: number;
  minSize: number;
  dimension: "width" | "height";
  transition: string;
}

export function getResizeConfig(direction: Direction): ResizeConfig {
  if (direction === "bottom") {
    return {
      axis: "y",
      cursor: "ns-resize",
      deltaSign: -1,
      maxRatio: 0.6,
      minSize: MIN_PANEL_HEIGHT,
      dimension: "height",
      transition: "height 150ms ease-out",
    };
  }
  return {
    axis: "x",
    cursor: "ew-resize",
    deltaSign: direction === "right" ? -1 : 1,
    maxRatio: 0.5,
    minSize: MIN_PANEL_WIDTH,
    dimension: "width",
    transition: "width 150ms ease-out",
  };
}

function getHandleStyle(direction: Direction): React.CSSProperties {
  if (direction === "right") {
    return { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, cursor: "ew-resize", zIndex: 10 };
  }
  if (direction === "left") {
    return { position: "absolute", right: 0, top: 0, bottom: 0, width: 4, cursor: "ew-resize", zIndex: 10 };
  }
  return { position: "absolute", top: 0, left: 0, right: 0, height: 4, cursor: "ns-resize", zIndex: 10 };
}

interface ResizeHandleProps {
  direction: Direction;
  currentSize: number;
  enabled: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  onResizeEnd: (size: number) => void;
}

export function ResizeHandle({ direction, currentSize, enabled, panelRef, contentRef, onResizeEnd }: ResizeHandleProps) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const config = getResizeConfig(direction);

  useEffect(() => {
    return () => { cleanupRef.current?.(); };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!enabled) return;
    e.preventDefault();

    document.body.style.userSelect = "none";
    if (panelRef.current) panelRef.current.style.transition = "none";

    const startPos = config.axis === "x" ? e.clientX : e.clientY;
    const startSize = currentSize;
    let lastSize = currentSize;

    const onMouseMove = (ev: MouseEvent) => {
      const parentRect = panelRef.current?.parentElement?.getBoundingClientRect();
      const parentDim = parentRect ? parentRect[config.dimension] : Infinity;
      const maxSize = parentDim * config.maxRatio;
      const currentPos = config.axis === "x" ? ev.clientX : ev.clientY;
      const delta = config.deltaSign * (currentPos - startPos);
      const newSize = Math.min(Math.max(startSize + delta, config.minSize), maxSize);
      lastSize = newSize;
      if (panelRef.current) panelRef.current.style[config.dimension] = newSize + "px";
      if (contentRef.current) contentRef.current.style[config.dimension] = newSize + "px";
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      onResizeEnd(lastSize);
      if (panelRef.current) panelRef.current.style.transition = config.transition;
      cleanupRef.current = null;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    cleanupRef.current = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
    };
  };

  return (
    <div
      data-testid="resize-handle"
      style={getHandleStyle(direction)}
      onMouseDown={handleMouseDown}
    />
  );
}
