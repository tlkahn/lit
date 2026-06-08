import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  RefObject,
} from "react";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const DEBOUNCE_MS = 300;
const ZOOM_STEP = 1.25;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

interface UsePdfZoomArgs {
  /** `rendered !== null` gate for the native wheel listener. */
  ready: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** Debounced sharp re-render owned by PdfViewer (mutates renderedZoomRef). */
  renderSharp: (zoom: number) => void;
}

interface UsePdfZoomResult {
  zoomLevel: number;
  zoomLevelRef: MutableRefObject<number>;
  applyZoom: (compute: (z: number) => number) => void;
  resetZoom: () => void;
  /** Returns true if the event was a zoom chord and was handled. */
  handleZoomKey: (e: ReactKeyboardEvent) => boolean;
}

export function usePdfZoom({
  ready,
  scrollContainerRef,
  renderSharp,
}: UsePdfZoomArgs): UsePdfZoomResult {
  const [zoomLevel, setZoomLevel] = useState(1);
  // Always-current zoomLevel for closures (the native wheel listener) and the
  // applyZoom helper, which needs the old value to preserve scroll center.
  const zoomLevelRef = useRef(1);
  const zoomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep zoomLevelRef in sync so the native wheel listener and applyZoom read
  // the current zoom without re-subscribing.
  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
  }, [zoomLevel]);

  // Debounce sharp re-renders so rapid zoom gestures only render the final DPI.
  // Gated on `ready`: the effect must not fire until the PDF is open and page 0
  // is cached (PdfViewer sets `rendered` only after `pdfOpen` resolves). Without
  // this gate, a slow `pdfOpen` (large file / slow disk) could let the 300ms
  // timer fire renderSharp against a not-yet-open PDF, whose rejection sets a
  // permanent error. Re-arms when `ready` flips true; that first fire is
  // zoomLevel=1 → renderSharp(1), a cheap cache hit. The cleanup-clear resets
  // the timer on every zoomLevel change.
  useEffect(() => {
    if (!ready) return;
    if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
    zoomDebounceRef.current = setTimeout(() => {
      void renderSharp(zoomLevel);
    }, DEBOUNCE_MS);
    return () => {
      if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
    };
  }, [ready, zoomLevel, renderSharp]);

  // Apply a zoom change computed from the current logical zoom, preserving the
  // viewport center across the instant CSS-zoom resize. Scroll must be adjusted
  // by the LOGICAL ratio next/old at the gesture moment (the wrapper resizes
  // immediately via cssScale) — not at debounce time. All four zoom triggers
  // route through here so old/new are both available.
  const applyZoom = useCallback(
    (compute: (z: number) => number) => {
      const old = zoomLevelRef.current;
      const next = clampZoom(compute(old));
      if (next === old) return;
      const el = scrollContainerRef.current;
      // Capture the center-preserving scroll target from the CURRENT (old)
      // layout, but DEFER the DOM write to after React commits the new zoom.
      // The wrapper's pixel size is driven by zoomLevel state; writing scrollTop
      // before the larger wrapper is committed would let the browser clamp it to
      // the old (smaller) max scroll on zoom-in (CSSOM View clamps at assignment
      // time), losing the position. requestAnimationFrame runs after the paint
      // of the committed wrapper, so the new max scroll is in effect.
      const target = el
        ? {
            top: (el.scrollTop + el.clientHeight / 2) * (next / old) - el.clientHeight / 2,
            left: (el.scrollLeft + el.clientWidth / 2) * (next / old) - el.clientWidth / 2,
          }
        : null;
      zoomLevelRef.current = next;
      setZoomLevel(next);
      if (el && target) {
        requestAnimationFrame(() => {
          el.scrollTop = target.top;
          el.scrollLeft = target.left;
        });
      }
    },
    [scrollContainerRef],
  );

  // Reset to 100% (on file change). renderedZoomRef stays in PdfViewer.
  const resetZoom = useCallback(() => {
    zoomLevelRef.current = 1;
    setZoomLevel(1);
  }, []);

  const handleZoomKey = useCallback(
    (e: ReactKeyboardEvent): boolean => {
      // Zoom chords (ctrl/cmd) take priority and short-circuit page nav, which
      // otherwise fires on j/k/arrows without checking modifier keys.
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        applyZoom((z) => z * ZOOM_STEP);
        return true;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        applyZoom((z) => z / ZOOM_STEP);
        return true;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        applyZoom(() => 1);
        return true;
      }
      return false;
    },
    [applyZoom],
  );

  // The scroll container only mounts once `rendered` is non-null (the component
  // early-returns the loading UI before then). Gate the listener on readiness so
  // it re-attaches once the container exists. React's onWheel is passive, so we
  // use a native non-passive listener to be able to preventDefault() and thereby
  // suppress the browser's own ctrl+scroll page zoom.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      applyZoom((z) => z * Math.exp(-e.deltaY / 300));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ready, applyZoom, scrollContainerRef]);

  return { zoomLevel, zoomLevelRef, applyZoom, resetZoom, handleZoomKey };
}
