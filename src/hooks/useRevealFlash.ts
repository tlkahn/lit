import { useState, useRef, useCallback, useEffect } from "react";

/**
 * Ref to any virtualizer that supports `scrollToIndex`.
 * Both Sidebar and ReferenceLibrary keep a mutable ref that is
 * updated each render, so this captures the minimal interface.
 */
interface VirtualizerLike {
  scrollToIndex(index: number, options?: { align?: string }): void;
}

/**
 * Shared reveal-flash orchestration used by the sidebar file tree and the
 * reference library.  Encapsulates:
 *
 * 1. A `revealedKey` state that callers compare against their item keys
 *    to apply a CSS flash class (e.g. `sidebar-item-revealed`,
 *    `bib-entry-revealed`).
 * 2. A 1 500 ms timer that automatically clears the flash.  Rapid
 *    consecutive reveals reset the timer so the previous key's flash
 *    does not linger.
 * 3. A double-`requestAnimationFrame` scroll schedule.  The first rAF
 *    lets React commit the state updates that made the target row
 *    visible (expanded ancestors / cleared search).  The second rAF
 *    lets the virtualizer re-measure after React has painted the new
 *    row count, so `scrollToIndex` targets the correct offset.
 *
 * If `scrollIndex` is negative the scroll is skipped (the item is not
 * in the visible list) but the flash still fires — callers may want to
 * highlight a "not found" state.
 */
export function useRevealFlash(
  virtualizerRef: React.MutableRefObject<VirtualizerLike>,
) {
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const deferRef = useRef<ReturnType<typeof setTimeout>>();

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
      clearTimeout(deferRef.current);
    };
  }, []);

  const triggerReveal = useCallback(
    (key: string, scrollIndex: number) => {
      // Clear any pending deferred set and auto-clear timer
      clearTimeout(deferRef.current);
      clearTimeout(timerRef.current);

      // Synchronously clear the key so React removes the flash class
      // this render.  The deferred setTimeout(0) re-sets it in the next
      // event-loop tick, producing a second render that re-adds the class
      // and restarts the CSS animation — even if the key is the same.
      setRevealedKey(null);
      deferRef.current = setTimeout(() => {
        setRevealedKey(key);
        timerRef.current = setTimeout(() => setRevealedKey(null), 1500);
      }, 0);

      if (scrollIndex >= 0) {
        // Double-rAF: the first requestAnimationFrame lets React commit
        // the state updates that made the target row visible (e.g.
        // expanded ancestors, cleared search filter).  The second rAF
        // lets the virtualizer re-measure after React has painted the
        // new row count, so scrollToIndex targets the correct offset.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            virtualizerRef.current.scrollToIndex(scrollIndex, {
              align: "center",
            });
          });
        });
      }
    },
    [virtualizerRef],
  );

  return { revealedKey, triggerReveal };
}
