import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { createGestureState, processWheelEvent, BOUNDARY_TOLERANCE } from "../lib/trackpadGesture";
import type { ScrollBoundary } from "../lib/trackpadGesture";

interface UseTrackpadPageNavOptions {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  currentPageRef: MutableRefObject<number>;
  spaceHeldRef: MutableRefObject<boolean>;
  pageCount: number;
  goToPage: (index: number) => void;
  enabled: boolean;
}

export function useTrackpadPageNav({
  scrollContainerRef,
  currentPageRef,
  spaceHeldRef,
  pageCount,
  goToPage,
  enabled,
}: UseTrackpadPageNavOptions) {
  const gestureRef = useRef(createGestureState());

  useEffect(() => {
    if (!enabled) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const handler = (e: WheelEvent) => {
      if (spaceHeldRef.current) return;
      if (e.ctrlKey) return;

      const el = container;
      const hasVerticalOverflow = el.scrollHeight - el.clientHeight > BOUNDARY_TOLERANCE;
      const atTop = el.scrollTop <= BOUNDARY_TOLERANCE;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - BOUNDARY_TOLERANCE;
      const boundary: ScrollBoundary = { atTop, atBottom, hasVerticalOverflow };

      const nav = processWheelEvent(gestureRef.current, e.deltaY, e.timeStamp, boundary);

      let navigated = false;

      if (nav === "next") {
        const current = currentPageRef.current;
        if (current < pageCount - 1) {
          goToPage(current + 1);
          navigated = true;
        }
      } else if (nav === "prev") {
        const current = currentPageRef.current;
        if (current > 0) {
          goToPage(current - 1);
          navigated = true;
        }
      }

      if (navigated) {
        e.preventDefault();
      }
    };

    container.addEventListener("wheel", handler, { passive: false });
    return () => container.removeEventListener("wheel", handler);
  }, [scrollContainerRef, currentPageRef, spaceHeldRef, pageCount, goToPage, enabled]);
}
