import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView, Tooltip } from "@codemirror/view";
import { hoverTooltip } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { buildFootnoteMap, type FootnoteMap } from "./footnoteNumbering";

export function getFootnoteDefBody(
  state: EditorState,
  label: string,
  footnoteMap: FootnoteMap,
): string | null {
  const defRange = footnoteMap.defPositions.get(label);
  if (!defRange) return null;

  const fullText = state.doc.sliceString(defRange.from, defRange.to);
  const markMatch = /^\[\^[a-zA-Z0-9_-]+\]:\s?/.exec(fullText);
  if (!markMatch) return "";

  const afterMark = fullText.slice(markMatch[0].length);
  const lines = afterMark.split("\n");
  const stripped = lines.map((line, i) => {
    if (i === 0) return line;
    return line.replace(/^(?:\t| {4})/, "");
  });
  return stripped.join("\n");
}

export function renderFootnoteBody(bodyText: string): string {
  return DOMPurify.sanitize(marked.parse(bodyText, { async: false }) as string);
}

export function footnoteTooltipSource(
  view: EditorView,
  pos: number,
  _side: 1 | -1,
): Tooltip | null {
  const tree = syntaxTree(view.state);
  const node = tree.resolve(pos, 1);
  if (node.name !== "FootnoteRef") {
    const parent = node.parent;
    if (!parent || parent.name !== "FootnoteRef") return null;
  }

  const refNode = node.name === "FootnoteRef" ? node : node.parent!;
  const marks = refNode.getChildren("FootnoteRefMark");
  if (marks.length < 2) return null;

  const label = view.state.doc.sliceString(marks[0]!.to, marks[1]!.from);
  const footnoteMap = buildFootnoteMap(view.state);
  const body = getFootnoteDefBody(view.state, label, footnoteMap);
  if (body == null) return null;

  return {
    pos: refNode.from,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-footnote-tooltip";
      dom.innerHTML = renderFootnoteBody(body);
      return { dom };
    },
  };
}

export function footnoteTooltipExtension(): Extension {
  return hoverTooltip(footnoteTooltipSource, { hideOnChange: true });
}
