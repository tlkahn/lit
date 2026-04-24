import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

function findImageRange(state: EditorState, pos: number): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "Image" && node.from <= pos && node.to >= pos) {
        result = { from: node.from, to: node.to };
        return false;
      }
    },
  });
  return result;
}

export function createImageClickHandler(): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement;
      if (!target.closest(".cm-preview-image")) return false;

      const pos = view.posAtDOM(target);
      const range = findImageRange(view.state, pos);
      if (!range) return false;

      event.preventDefault();
      view.focus();
      view.dispatch({
        selection: { anchor: range.from, head: range.to },
      });
      return true;
    },
  });
}
