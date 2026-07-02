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
  // Elements observed via refs, which attach before effects and are not
  // re-invoked on a StrictMode remount — the effect re-observes from this set.
  const observed = useRef<Set<HTMLElement>>(new Set());
  const roRef = useRef<ResizeObserver | null>(null);

  const flush = useCallback(() => {
    rafId.current = 0;
    for (const [el, h] of pending.current) {
      const span = computeSpan(h, MASONRY_ROW_HEIGHT, MASONRY_GAP);
      const wrapper = el.parentElement;
      if (wrapper) wrapper.style.gridRowEnd = `span ${span}`;
    }
    pending.current.clear();
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight;
        pending.current.set(entry.target as HTMLElement, h);
      }
      if (!rafId.current) {
        rafId.current = requestAnimationFrame(flush);
      }
    });
    roRef.current = ro;
    for (const el of observed.current) ro.observe(el);
    return () => {
      ro.disconnect();
      roRef.current = null;
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = 0;
      }
      pending.current.clear();
    };
  }, [flush]);

  const ctx = useRef<MasonryObserverContextValue>({
    observe: (el) => {
      observed.current.add(el);
      roRef.current?.observe(el);
    },
    unobserve: (el) => {
      observed.current.delete(el);
      pending.current.delete(el);
      roRef.current?.unobserve(el);
    },
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

  // Cleanup happens via the ref callback receiving null on unmount — no
  // effect-based cleanup, which would unobserve on StrictMode's simulated
  // unmount without a matching re-observe (refs are not re-invoked).
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
