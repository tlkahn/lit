import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

function isInsideFencedCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    if (node.name === "FencedCode") return true;
    if (!node.parent) break;
    node = node.parent;
  }
  return false;
}

export function createAnnotationInputHandler(): Extension {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== "-" || from !== to) return false;

    const { state } = view;
    const pos = from;
    if (pos < 4) return false;

    const preceding = state.doc.sliceString(pos - 4, pos);
    if (preceding !== "<!--") return false;

    if (isInsideFencedCode(state, pos)) return false;

    view.dispatch({ changes: { from: pos - 4, to: pos } });
    window.dispatchEvent(new CustomEvent("lit:open-annotation-builder"));
    return true;
  });
}
