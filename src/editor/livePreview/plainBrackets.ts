import { type EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { isCitationBracket } from "./citeproc";

export function normalizeRefLabel(label: string): string {
  return label.trim().replace(/[\s]+/g, " ").toLowerCase();
}

export function collectRefDefLabels(state: EditorState): Set<string> {
  const labels = new Set<string>();
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "LinkReference") {
        const linkLabel = node.node.getChild("LinkLabel");
        if (linkLabel) {
          const raw = state.doc.sliceString(linkLabel.from + 1, linkLabel.to - 1);
          labels.add(normalizeRefLabel(raw));
        }
        return false;
      }
    },
  });
  return labels;
}

const plainBracketMark = Decoration.mark({ class: "cm-plain-brackets" });

export function addPlainBracketDecos(
  state: EditorState,
  from: number,
  to: number,
  node: { getChildren(type: string): { from: number; to: number }[]; getChild(type: string): { from: number; to: number } | null },
  refLabels: Set<string>,
  decos: { from: number; to: number; deco: Decoration }[],
): void {
  if (node.getChild("URL")) return;

  const linkMarks = node.getChildren("LinkMark");
  if (linkMarks.length >= 3) return;

  const text = state.doc.sliceString(from, to);
  if (isCitationBracket(text)) return;

  const linkLabel = node.getChild("LinkLabel");
  let refText: string;
  if (linkLabel) {
    const labelContent = state.doc.sliceString(linkLabel.from + 1, linkLabel.to - 1);
    if (labelContent.length > 0) {
      refText = labelContent;
    } else if (linkMarks.length >= 2) {
      refText = state.doc.sliceString(linkMarks[0]!.to, linkMarks[1]!.from);
    } else {
      refText = text.slice(1, -1);
    }
  } else if (linkMarks.length >= 2) {
    refText = state.doc.sliceString(linkMarks[0]!.to, linkMarks[1]!.from);
  } else {
    refText = text.slice(1, -1);
  }

  if (refLabels.has(normalizeRefLabel(refText))) return;

  decos.push({ from, to, deco: plainBracketMark });
}
