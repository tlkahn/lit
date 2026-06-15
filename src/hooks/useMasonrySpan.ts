import { useRef, useState, useEffect } from "react";
import { computeSpan, MASONRY_ROW_HEIGHT, MASONRY_GAP } from "../lib/computeSpan";

export function useMasonrySpan() {
  const contentRef = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState(1);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight;
        setSpan(computeSpan(h, MASONRY_ROW_HEIGHT, MASONRY_GAP));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { contentRef, span };
}
