import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

// Positions only (defPositions for jump/tooltip). Display markers use the
// source label string (#1003), not appearance-order indices. Full-document
// renderMarkdown / markedFootnote may still emit sequential export ids.
export interface FootnoteMap {
  defPositions: Map<string, { from: number; to: number }>;
}

export function buildFootnoteMap(state: EditorState): FootnoteMap {
  const defPositions = new Map<string, { from: number; to: number }>();

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FootnoteDef") {
        const mark = node.node.getChild("FootnoteDefMark");
        if (mark) {
          const markText = state.doc.sliceString(mark.from, mark.to);
          const match = /^\[\^([a-zA-Z0-9_-]+)\]:$/.exec(markText);
          if (match) {
            defPositions.set(match[1]!, { from: node.from, to: node.to });
          }
        }
      }
    },
  });

  return { defPositions };
}
