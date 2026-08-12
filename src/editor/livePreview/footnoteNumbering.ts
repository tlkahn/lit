import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

// Positions only; display uses source labels (see doc/plans/issue-1003.md).
export interface FootnoteMap {
  refPositions: Map<string, number[]>;
  defPositions: Map<string, { from: number; to: number }>;
}

export function buildFootnoteMap(state: EditorState): FootnoteMap {
  const refPositions = new Map<string, number[]>();
  const defPositions = new Map<string, { from: number; to: number }>();

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FootnoteRef") {
        const marks = node.node.getChildren("FootnoteRefMark");
        if (marks.length >= 2) {
          const label = state.doc.sliceString(marks[0]!.to, marks[1]!.from);
          if (!refPositions.has(label)) {
            refPositions.set(label, []);
          }
          refPositions.get(label)!.push(node.from);
        }
      }
      if (node.name === "FootnoteDef") {
        const mark = node.node.getChild("FootnoteDefMark");
        if (mark) {
          const markText = state.doc.sliceString(mark.from, mark.to);
          const match = /^\[\^([a-zA-Z0-9_-]+)\]:$/.exec(markText);
          if (match) {
            const label = match[1]!;
            defPositions.set(label, { from: node.from, to: node.to });
          }
        }
      }
    },
  });

  return { refPositions, defPositions };
}
