import { syntaxTree } from "@codemirror/language";
import { insertTab, indentLess } from "@codemirror/commands";
import type { EditorState } from "@codemirror/state";
import type { Command } from "@codemirror/view";

const LIST_INDENT = 2;

const EMPTY_LIST_ITEM_RE = /^(\s+)([-*+]|\d+\.)\s*(\[[ x]\]\s*)?$/;

function isInListItem(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    if (node.name === "BulletList" || node.name === "OrderedList") return true;
    if (!node.parent) break;
    node = node.parent;
  }
  return false;
}

export const enterInList: Command = (view) => {
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const match = EMPTY_LIST_ITEM_RE.exec(line.text);
  if (!match) return false;

  const leadingSpaces = match[1]!.length;
  if (leadingSpaces < LIST_INDENT) return false;

  const removeCount = Math.min(LIST_INDENT, leadingSpaces);
  view.dispatch({
    changes: { from: line.from, to: line.from + removeCount, insert: "" },
  });
  return true;
};

export const indentListItem: Command = (view) => {
  const { state } = view;
  const pos = state.selection.main.head;
  if (!isInListItem(state, pos)) return insertTab(view);

  const line = state.doc.lineAt(pos);
  view.dispatch({
    changes: { from: line.from, insert: " ".repeat(LIST_INDENT) },
    selection: { anchor: pos + LIST_INDENT },
  });
  return true;
};

export const outdentListItem: Command = (view) => {
  const { state } = view;
  const pos = state.selection.main.head;
  if (!isInListItem(state, pos)) return indentLess(view);

  const line = state.doc.lineAt(pos);
  const leadingSpaces = line.text.length - line.text.trimStart().length;
  if (leadingSpaces === 0) return false;

  const removeCount = Math.min(LIST_INDENT, leadingSpaces);
  view.dispatch({
    changes: { from: line.from, to: line.from + removeCount, insert: "" },
    selection: { anchor: Math.max(line.from, pos - removeCount) },
  });
  return true;
};
