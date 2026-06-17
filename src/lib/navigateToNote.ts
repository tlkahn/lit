import { globalJumpTracker } from "../editor/jumpTracker";
import { useWorkspaceStore } from "../stores/workspace";

export interface NavigateToNoteOpts {
  flash?: boolean;
}

/**
 * Record a jump and navigate to `targetId` at `targetLine`.
 * If already on the target page, dispatches lit:scroll-to-line;
 * otherwise calls selectPageAtLine.
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

  if (targetId === currentPagePath) {
    window.dispatchEvent(
      new CustomEvent("lit:scroll-to-line", {
        detail: { line: targetLine, cursor: true, ...(opts.flash && { flash: true }) },
      }),
    );
  } else {
    selectPageAtLine(targetId, targetLine);
  }
}
