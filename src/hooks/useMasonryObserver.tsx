import { createContext, useContext, useEffect, useRef, useCallback, type ReactNode } from "react";
import { computeSpan, MASONRY_ROW_HEIGHT, MASONRY_GAP } from "../lib/computeSpan";

interface MasonryObserverContextValue {
  observe: (el: HTMLElement) => void;
  unobserve: (el: HTMLElement) => void;
}

const MasonryObserverContext = createContext<MasonryObserverContextValue | null>(null);

export function MasonryObserverProvider({ children }: { children: ReactNode }) {
  const rafId = useRef(0);
  const pending = useRef<Map<HTMLElement, number>>(new Map());

  const flush = useCallback(() => {
    rafId.current = 0;
    for (const [el, h] of pending.current) {
      const span = computeSpan(h, MASONRY_ROW_HEIGHT, MASONRY_GAP);
      const wrapper = el.parentElement;
      if (wrapper) wrapper.style.gridRowEnd = `span ${span}`;
    }
    pending.current.clear();
  }, []);

  const roRef = useRef<ResizeObserver | null>(null);
  if (!roRef.current) {
    roRef.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight;
        pending.current.set(entry.target as HTMLElement, h);
      }
      if (!rafId.current) {
        rafId.current = requestAnimationFrame(flush);
      }
    });
  }

  useEffect(() => {
    return () => {
      roRef.current?.disconnect();
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  const ctx = useRef<MasonryObserverContextValue>({
    observe: (el) => roRef.current?.observe(el),
    unobserve: (el) => roRef.current?.unobserve(el),
  }).current;

  return (
    <MasonryObserverContext.Provider value={ctx}>
      {children}
    </MasonryObserverContext.Provider>
  );
}

export function useMasonryRef(): (node: HTMLDivElement | null) => void {
  const ctx = useContext(MasonryObserverContext);
  const prevEl = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (prevEl.current && ctx) ctx.unobserve(prevEl.current);
    };
  }, [ctx]);

  return useCallback(
    (node: HTMLDivElement | null) => {
      if (!ctx) return;
      if (prevEl.current) ctx.unobserve(prevEl.current);
      prevEl.current = node;
      if (node) ctx.observe(node);
    },
    [ctx],
  );
}
