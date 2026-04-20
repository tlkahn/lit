import type { Extension } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

export function getLinkUrlAtPos(state: EditorState, pos: number): string | null {
  let url: string | null = null;
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter: (node) => {
      if (node.name === "Link") {
        const urlNode = node.node.getChild("URL");
        if (urlNode) {
          const linkMarks = node.node.getChildren("LinkMark");
          if (linkMarks.length >= 2 && linkMarks[0] && linkMarks[1]) {
            const textFrom = linkMarks[0].to;
            const textTo = linkMarks[1].from;
            if (pos >= textFrom && pos <= textTo) {
              url = state.doc.sliceString(urlNode.from, urlNode.to);
            }
          }
        }
        return false;
      }
    },
  });
  return url;
}

export function createLinkClickHandler(
  openUrl: (url: string) => void,
): Extension {
  return EditorView.domEventHandlers({
    click(event, view) {
      const isMod = event.ctrlKey || event.metaKey;
      if (!isMod) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const url = getLinkUrlAtPos(view.state, pos);
      if (url) {
        event.preventDefault();
        openUrl(url);
        return true;
      }
      return false;
    },
  });
}
