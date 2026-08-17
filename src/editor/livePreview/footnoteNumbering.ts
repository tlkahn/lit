import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

// Positions only (defPositions for jump/tooltip). Display markers use the
// source label string (#1003), not appearance-order indices. Full-document
// renderMarkdown / markedFootnote may still emit sequential export ids.
export interface FootnoteMap {
  defPositions: Map<string, { from: number; to: number }>;
  /** First FootnoteRef `from` per label, in document order. */
  firstRefPositions: Map<string, number>;
}

const FOOTNOTE_DEF_LABEL_RE = /^\[\^([a-zA-Z0-9_-]+)\]:$/;

/**
 * Extract the source label from a `[^label]:` definition mark's raw text.
 * Returns null when the text is not a well-formed def marker (callers skip
 * unparsed marks rather than inventing a fallback label).
 */
export function parseFootnoteDefLabel(markText: string): string | null {
  const m = FOOTNOTE_DEF_LABEL_RE.exec(markText);
  return m?.[1] ?? null;
}

export function buildFootnoteMap(state: EditorState): FootnoteMap {
  const defPositions = new Map<string, { from: number; to: number }>();
  const firstRefPositions = new Map<string, number>();

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FootnoteDef") {
        const mark = node.node.getChild("FootnoteDefMark");
        if (mark) {
          const label = parseFootnoteDefLabel(state.doc.sliceString(mark.from, mark.to));
          if (label) {
            defPositions.set(label, { from: node.from, to: node.to });
          }
        }
      }
      if (node.name === "FootnoteRef") {
        const marks = node.node.getChildren("FootnoteRefMark");
        if (marks.length < 2) return;
        const label = state.doc.sliceString(marks[0]!.to, marks[1]!.from);
        if (!firstRefPositions.has(label)) {
          firstRefPositions.set(label, node.from);
        }
      }
    },
  });

  return { defPositions, firstRefPositions };
}
