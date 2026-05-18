import { useRef, useEffect, useCallback } from "react";
import { usePaneStore, findSplitByPath } from "../stores/panes";

const MIN_PANE_PCT = 10;

export interface PaneDividerProps {
  splitPath: number[];
  direction: "horizontal" | "vertical";
  index: number;
}

function computeNewSizes(
  startSizes: number[],
  index: number,
  deltaPct: number,
  minPct: number,
): number[] {
  const sizes = startSizes.slice();
  let left = sizes[index]! + deltaPct;
  let right = sizes[index + 1]! - deltaPct;

  if (left < minPct) {
    left = minPct;
    right = startSizes[index]! + startSizes[index + 1]! - minPct;
  } else if (right < minPct) {
    right = minPct;
    left = startSizes[index]! + startSizes[index + 1]! - minPct;
  }

  sizes[index] = left;
  sizes[index + 1] = right;
  return sizes;
}

export function PaneDivider({ splitPath, direction, index }: PaneDividerProps) {
  const resize = usePaneStore((s) => s.resize);

  const dividerRef = useRef<HTMLDivElement>(null);
  const dragStartPos = useRef(0);
  const startSizes = useRef<number[]>([]);
  const pendingSizes = useRef<number[] | null>(null);
  const rafIdRef = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const splitPathRef = useRef(splitPath);
  splitPathRef.current = splitPath;
  const indexRef = useRef(index);
  indexRef.current = index;

  const isHorizontal = direction === "horizontal";

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();

      const root = usePaneStore.getState().root;
      const split = findSplitByPath(root, splitPathRef.current);
      if (!split) return;

      dragStartPos.current = isHorizontal ? e.clientX : e.clientY;
      startSizes.current = split.sizes.slice();
      document.body.style.userSelect = "none";

      const onMouseMove = (ev: MouseEvent) => {
        const container = dividerRef.current?.parentElement;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const containerSize = isHorizontal ? rect.width : rect.height;
        if (containerSize <= 0) return;

        const pos = isHorizontal ? ev.clientX : ev.clientY;
        const deltaPixels = pos - dragStartPos.current;
        const deltaPct = (deltaPixels / containerSize) * 100;
        const newSizes = computeNewSizes(startSizes.current, indexRef.current, deltaPct, MIN_PANE_PCT);
        pendingSizes.current = newSizes;

        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = 0;
            if (pendingSizes.current) {
              resize(splitPathRef.current, pendingSizes.current);
              pendingSizes.current = null;
            }
          });
        }
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.userSelect = "";

        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = 0;
        }
        if (pendingSizes.current) {
          resize(splitPathRef.current, pendingSizes.current);
          pendingSizes.current = null;
        }

        cleanupRef.current = null;
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      cleanupRef.current = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.userSelect = "";
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = 0;
        }
      };
    },
    [isHorizontal, resize],
  );

  const handleDoubleClick = useCallback(() => {
    const root = usePaneStore.getState().root;
    const split = findSplitByPath(root, splitPathRef.current);
    if (!split) return;
    const count = split.children.length;
    const equalSize = 100 / count;
    resize(splitPathRef.current, Array(count).fill(equalSize));
  }, [resize]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  return (
    <div
      ref={dividerRef}
      data-testid="pane-divider"
      role="separator"
      aria-orientation={direction}
      className="flex-none relative flex items-center justify-center"
      style={{
        cursor: isHorizontal ? "ew-resize" : "ns-resize",
        ...(isHorizontal ? { width: 4 } : { height: 4 }),
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <div
        data-testid="pane-divider-line"
        className="bg-border-faint"
        style={isHorizontal ? { width: 1, height: "100%" } : { height: 1, width: "100%" }}
      />
    </div>
  );
}
