import { useEffect, useRef } from "react";

/**
 * Auto-focus a pane's container element when the pane is focused but has no
 * file open. This ensures keyboard shortcuts (e.g. Ctrl-W) still work in
 * newly-split empty panes that have no CodeMirror editor to receive focus.
 *
 * Returns a ref to attach to the empty-state wrapper div.
 */
export function useEmptyPaneFocus(
  isFocused: boolean,
  pagePath: string | null,
) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isFocused && !pagePath) {
      ref.current?.focus();
    }
  }, [isFocused, pagePath]);
  return ref;
}
