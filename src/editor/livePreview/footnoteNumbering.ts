import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

export interface FootnoteMap {
  labelToNumber: Map<string, number>;
  refPositions: Map<string, number[]>;
  defPositions: Map<string, { from: number; to: number }>;
}

export function buildFootnoteMap(state: EditorState): FootnoteMap {
  const labelToNumber = new Map<string, number>();
  const refPositions = new Map<string, number[]>();
  const defPositions = new Map<string, { from: number; to: number }>();

  const refOrder: string[] = [];
  const defLabels = new Set<string>();

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FootnoteRef") {
        const marks = node.node.getChildren("FootnoteRefMark");
        if (marks.length >= 2) {
          const label = state.doc.sliceString(marks[0]!.to, marks[1]!.from);
          if (!refPositions.has(label)) {
            refPositions.set(label, []);
            refOrder.push(label);
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
            defLabels.add(label);
            defPositions.set(label, { from: node.from, to: node.to });
          }
        }
      }
    },
  });

  let num = 1;
  for (const label of refOrder) {
    if (!labelToNumber.has(label)) {
      labelToNumber.set(label, num++);
    }
  }
  for (const label of defLabels) {
    if (!labelToNumber.has(label)) {
      labelToNumber.set(label, num++);
    }
  }

  return { labelToNumber, refPositions, defPositions };
}
