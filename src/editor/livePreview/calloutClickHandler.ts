import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { parseCalloutType } from "./callout";

function findCalloutRange(state: EditorState, pos: number): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "Blockquote" && node.from <= pos && node.to >= pos) {
        const firstLine = state.doc.lineAt(node.from);
        if (parseCalloutType(firstLine.text)) {
          result = { from: node.from, to: node.to };
          return false;
        }
      }
    },
  });
  return result;
}

export function createCalloutClickHandler(): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement;

      if (target.closest(".cm-callout-fold-icon")) return false;

      const calloutHeader = target.closest(".cm-callout-header") as HTMLElement | null;
      if (!calloutHeader) return false;

      const pos = view.posAtDOM(calloutHeader);
      const range = findCalloutRange(view.state, pos);
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
