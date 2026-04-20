import type { EditorState } from "@codemirror/state";

export function isCursorOnLine(
  state: EditorState,
  nodeFrom: number,
  nodeTo: number,
): boolean {
  const sel = state.selection.main;
  const nodeStartLine = state.doc.lineAt(nodeFrom).number;
  const nodeEndLine = state.doc.lineAt(nodeTo).number;
  const cursorLine = state.doc.lineAt(sel.head).number;
  return cursorLine >= nodeStartLine && cursorLine <= nodeEndLine;
}
