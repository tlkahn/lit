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
