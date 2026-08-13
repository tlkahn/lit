export const EDITOR_FOCUS_EVENT = "lit:request-editor-focus";

/**
 * Whether the editor view should claim DOM focus after a document replace.
 * Skip when an editable field or the file-tree sidebar currently holds focus —
 * sidebar-initiated navigation keeps keyboard focus in the tree (VS Code style).
 */
export function shouldEditorClaimFocus(active: Element | null): boolean {
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return false;
  }
  if (active?.closest('[role="tree"]')) return false;
  return true;
}

/** Ask the focused editor pane to take keyboard focus. */
export function dispatchEditorFocusRequest(): void {
  window.dispatchEvent(new CustomEvent(EDITOR_FOCUS_EVENT));
}

/** True when focus is moving into the CM pane chrome / body. */
export function isEditorChrome(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("[data-testid='editor-pane']") ||
      target.closest(".cm-editor"),
  );
}
