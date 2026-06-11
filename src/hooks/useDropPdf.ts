import { useEffect, useRef, useCallback, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { DragDropEvent } from "@tauri-apps/api/webviewWindow";

/** Check if a logical point is inside a DOMRect. */
export function isInsideRect(
  logicalX: number,
  logicalY: number,
  rect: DOMRect,
): boolean {
  return (
    logicalX >= rect.left &&
    logicalX <= rect.right &&
    logicalY >= rect.top &&
    logicalY <= rect.bottom
  );
}

/** Filter an array of file paths to only those ending in .pdf (case-insensitive). */
export function filterPdfPaths(paths: string[]): string[] {
  return paths.filter((p) => /\.pdf$/i.test(p));
}

export interface UseDropPdfResult {
  /** The ref to attach to the panel container element for hit-testing. */
  panelRef: React.RefObject<HTMLDivElement>;
  /** Whether a drag is currently hovering over the panel. */
  isDropHighlighted: boolean;
  /** The last dropped PDF path (consumed and cleared by the caller). */
  droppedPdfPath: string | null;
  /** Clear the dropped path after consuming it. */
  clearDroppedPdfPath: () => void;
}

export function useDropPdf(opts: {
  enabled: boolean;
  showToast: (message: string, variant?: "success" | "error" | "progress") => void;
}): UseDropPdfResult {
  const panelRef = useRef<HTMLDivElement>(null!);
  const [isDropHighlighted, setIsDropHighlighted] = useState(false);
  const [droppedPdfPath, setDroppedPdfPath] = useState<string | null>(null);

  // Keep showToast in a ref to avoid re-subscribing when it changes
  const showToastRef = useRef(opts.showToast);
  showToastRef.current = opts.showToast;

  useEffect(() => {
    if (!opts.enabled) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const checkHit = (position: { x: number; y: number }): boolean => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return false;
      const logicalX = position.x / window.devicePixelRatio;
      const logicalY = position.y / window.devicePixelRatio;
      return isInsideRect(logicalX, logicalY, rect);
    };

    getCurrentWebviewWindow()
      .onDragDropEvent((event: { payload: DragDropEvent }) => {
        if (cancelled) return;
        const payload = event.payload;

        if (payload.type === "over" || payload.type === "enter") {
          setIsDropHighlighted(checkHit(payload.position));
        } else if (payload.type === "leave") {
          setIsDropHighlighted(false);
        } else if (payload.type === "drop") {
          setIsDropHighlighted(false);
          if (!checkHit(payload.position)) return;
          const pdfPaths = filterPdfPaths(payload.paths);
          if (pdfPaths.length === 0) {
            showToastRef.current("Only PDF files can be imported", "error");
          } else {
            if (pdfPaths.length > 1) {
              showToastRef.current(
                "Only the first PDF was imported -- multi-import is not yet supported",
              );
            }
            setDroppedPdfPath(pdfPaths[0]!);
          }
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [opts.enabled]);

  const clearDroppedPdfPath = useCallback(() => {
    setDroppedPdfPath(null);
  }, []);

  return {
    panelRef,
    isDropHighlighted,
    droppedPdfPath,
    clearDroppedPdfPath,
  };
}
