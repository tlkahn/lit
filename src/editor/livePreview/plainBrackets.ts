import { type EditorState, type Text } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { isCitationBracket } from "./citeBracket";

export function normalizeRefLabel(label: string): string {
  return label.trim().replace(/[\s]+/g, " ").toLowerCase();
}

const REF_DEF_RE = /^ {0,3}\[((?:\\.|[^[\]\\]){1,999})\]:/;

const labelCache = new WeakMap<Text, Set<string>>();

export function getRefDefLabels(state: EditorState): Set<string> {
  const doc = state.doc;
  const cached = labelCache.get(doc);
  if (cached) return cached;

  const labels = new Set<string>();
  const iter = doc.iterLines();
  while (!iter.done) {
    const m = REF_DEF_RE.exec(iter.value);
    if (m) {
      labels.add(normalizeRefLabel(m[1]!));
    }
    iter.next();
  }
  labelCache.set(doc, labels);
  return labels;
}

export function collectRefDefLabels(state: EditorState): Set<string> {
  return getRefDefLabels(state);
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
      refText = text.startsWith("![") ? text.slice(2, -1) : text.slice(1, -1);
    }
  } else if (linkMarks.length >= 2) {
    refText = state.doc.sliceString(linkMarks[0]!.to, linkMarks[1]!.from);
  } else {
    refText = text.startsWith("![") ? text.slice(2, -1) : text.slice(1, -1);
  }

  if (refLabels.has(normalizeRefLabel(refText))) return;

  decos.push({ from, to, deco: plainBracketMark });
}
