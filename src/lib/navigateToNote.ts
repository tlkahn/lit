import { globalJumpTracker } from "../editor/jumpTracker";
import { useWorkspaceStore } from "../stores/workspace";

export interface NavigateToNoteOpts {
  flash?: boolean;
}

/**
 * Record a jump and navigate to `targetId` at `targetLine` (1-based).
 *
 * Convention: `targetLine` is 1-based (matching source_line, pendingCursorLine,
 * and CM6's doc.line()).  The lit:scroll-to-line event expects 0-based lines
 * (its handler adds +1), so we convert when dispatching.
 */
export function navigateToNote(
  targetId: string,
  targetLine: number = 1,
  opts: NavigateToNoteOpts = {},
): void {
  const { currentPagePath, selectPageAtLine } = useWorkspaceStore.getState();

  globalJumpTracker.recordJump(
    { notePath: currentPagePath ?? "", line: 1, col: 0 },
    { notePath: targetId, line: targetLine, col: 0 },
  );

  // lit:scroll-to-line expects 0-based lines (handler adds +1)
  const scrollLine = Math.max(0, targetLine - 1);

  if (targetId === currentPagePath) {
    window.dispatchEvent(
      new CustomEvent("lit:scroll-to-line", {
        detail: { line: scrollLine, cursor: true, ...(opts.flash && { flash: true }) },
      }),
    );
  } else {
    selectPageAtLine(targetId, targetLine);
    if (opts.flash) {
      const unsub = useWorkspaceStore.subscribe((state) => {
        if (state.currentPagePath === targetId) {
          unsub();
          requestAnimationFrame(() => {
            window.dispatchEvent(
              new CustomEvent("lit:scroll-to-line", {
                detail: { line: scrollLine, cursor: false, flash: true },
              }),
            );
          });
        }
      });
    }
  }
}
