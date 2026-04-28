import type { Extension } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

export interface LinkInfo {
  url: string;
  from: number;
  to: number;
}

export function getLinkInfoAtPos(state: EditorState, pos: number): LinkInfo | null {
  let result: LinkInfo | null = null;
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
              result = {
                url: state.doc.sliceString(urlNode.from, urlNode.to),
                from: node.from,
                to: node.to,
              };
            }
          }
        }
        return false;
      }
    },
  });
  return result;
}

export function getLinkUrlAtPos(state: EditorState, pos: number): string | null {
  return getLinkInfoAtPos(state, pos)?.url ?? null;
}

export type LinkTargetKind = "url" | "path" | "anchor";

export function classifyLinkTarget(target: string): LinkTargetKind {
  if (target.startsWith("#")) return "anchor";
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(target)) return "url";
  return "path";
}

export interface LinkClickHandlers {
  openUrl: (url: string) => void;
  openFilePath?: (path: string) => void;
}

export function createLinkClickHandler(
  handlers: LinkClickHandlers,
): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false;
      if (event.ctrlKey || event.metaKey) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const info = getLinkInfoAtPos(view.state, pos);
      if (!info) return false;

      const head = view.state.selection.main.head;
      if (head >= info.from && head <= info.to) return false;

      const kind = classifyLinkTarget(info.url);
      if (kind === "anchor") return false;
      if (kind === "path") {
        if (!handlers.openFilePath) return false;
        event.preventDefault();
        handlers.openFilePath(info.url);
        return true;
      }
      event.preventDefault();
      handlers.openUrl(info.url);
      return true;
    },
  });
}
