import type { Extension } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

export interface WikilinkTarget {
  target: string;
  section: string | null;
  from: number;
  to: number;
}

export function getWikilinkTargetAtPos(
  state: EditorState,
  pos: number,
): WikilinkTarget | null {
  let result: WikilinkTarget | null = null;
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter: (node) => {
      if (node.name === "WikiLink") {
        const marks = node.node.getChildren("WikiLinkMark");
        if (marks.length < 2) return false;
        const openMark = marks[0]!;
        const closeMark = marks[1]!;
        if (pos < openMark.to || pos >= closeMark.from) return false;

        const content = state.doc.sliceString(openMark.to, closeMark.from);
        const pipeIndex = content.indexOf("|");
        const raw = pipeIndex >= 0 ? content.substring(0, pipeIndex) : content;
        const hashIndex = raw.indexOf("#");

        if (hashIndex >= 0) {
          result = {
            target: raw.substring(0, hashIndex),
            section: raw.substring(hashIndex + 1),
            from: node.from,
            to: node.to,
          };
        } else {
          result = { target: raw, section: null, from: node.from, to: node.to };
        }
        return false;
      }
    },
  });
  return result;
}

export type NavigateToPage = (target: string, section?: string, departurePos?: number) => void;

export function createWikilinkClickHandler(
  navigateToPage: NavigateToPage,
): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false;
      if (event.ctrlKey || event.metaKey) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const wikilink = getWikilinkTargetAtPos(view.state, pos);
      if (wikilink) {
        const head = view.state.selection.main.head;
        if (head >= wikilink.from && head <= wikilink.to) return false;
        event.preventDefault();
        navigateToPage(
          wikilink.target,
          wikilink.section ?? undefined,
          pos,
        );
        return true;
      }
      return false;
    },
  });
}
