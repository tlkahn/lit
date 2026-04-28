import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

function findNodeRange(
  state: EditorState,
  pos: number,
  nodeNames: string[],
): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (nodeNames.includes(node.name) && node.from <= pos && node.to >= pos) {
        result = { from: node.from, to: node.to };
        return false;
      }
    },
  });
  return result;
}

export function createLinkSelectHandler(): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.ctrlKey && !event.metaKey) return false;

      const target = event.target as HTMLElement;
      const el = target.closest(".cm-preview-link, .cm-preview-wikilink") as HTMLElement | null;
      if (!el) return false;

      const pos = view.posAtDOM(el);
      const nodeNames = el.classList.contains("cm-preview-wikilink")
        ? ["WikiLink"]
        : ["Link"];
      const range = findNodeRange(view.state, pos, nodeNames);
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
