import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

export function findMathRange(state: EditorState, pos: number): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  syntaxTree(state).iterate({
    enter: (node) => {
      if ((node.name === "InlineMath" || node.name === "DisplayMath") && node.from <= pos && node.to >= pos) {
        result = { from: node.from, to: node.to };
        return false;
      }
    },
  });
  return result;
}

export function createMathClickHandler(): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement;
      const mathEl = target.closest(".cm-preview-math-inline, .cm-preview-math-display") as HTMLElement | null;
      if (!mathEl) return false;

      const pos = view.posAtDOM(mathEl);
      const range = findMathRange(view.state, pos);
      if (!range) return false;

      event.preventDefault();
      view.focus();
      view.dispatch({
        selection: { anchor: range.from },
      });
      return true;
    },
  });
}
