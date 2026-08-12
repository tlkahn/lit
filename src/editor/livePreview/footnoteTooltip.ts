import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView, Tooltip } from "@codemirror/view";
import { hoverTooltip } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { buildFootnoteMap, type FootnoteMap } from "./footnoteNumbering";
import { renderMarkdown } from "../../lib/renderMarkdown";
import { loadKatex } from "./katexLoader";

export interface FootnoteDefBodyInfo {
  /** Doc position where body content starts (after mark + optional one sep). */
  bodyFrom: number;
  /** Doc position where the def ends (`node.to`). */
  bodyTo: number;
  /** Indent-stripped body text for renderMarkdown (may be ""). */
  bodyText: string;
}

/** Strip one leading tab or 4 spaces from every line after the first. */
function stripContinuationIndent(text: string): string {
  const lines = text.split("\n");
  const stripped = lines.map((line, i) => {
    if (i === 0) return line;
    return line.replace(/^(?:\t| {4})/, "");
  });
  return stripped.join("\n");
}

/**
 * From a FootnoteDef syntax node, derive the body span and the stripped body
 * text shared by the hover tooltip and the live-preview body widget.
 * Returns null if the node has no FootnoteDefMark child.
 */
export function getFootnoteDefBodyInfo(
  state: EditorState,
  defNode: {
    from: number;
    to: number;
    getChild(type: string): { from: number; to: number } | null;
  },
): FootnoteDefBodyInfo | null {
  const mark = defNode.getChild("FootnoteDefMark");
  if (!mark) return null;

  // Body starts after the mark + one optional trailing space/tab separator
  // (same convention as the mark-only replace in decorations). Never a
  // newline: an empty `[^1]:` followed by an indented continuation keeps the
  // newline inside the body range.
  let bodyFrom = mark.to;
  if (bodyFrom < defNode.to) {
    const next = state.doc.sliceString(bodyFrom, bodyFrom + 1);
    if (next === " " || next === "\t") bodyFrom += 1;
  }
  const bodyTo = defNode.to;

  const bodyText = stripContinuationIndent(
    state.doc.sliceString(bodyFrom, bodyTo),
  );
  return { bodyFrom, bodyTo, bodyText };
}

export function getFootnoteDefBody(
  state: EditorState,
  label: string,
  footnoteMap: FootnoteMap,
): string | null {
  const defRange = footnoteMap.defPositions.get(label);
  if (!defRange) return null;

  // Resolve the FootnoteDef node from the map range; both come from the same
  // syntax tree pass so they cannot drift.
  const tree = syntaxTree(state);
  let cur: ReturnType<typeof syntaxTree>["topNode"] | null = tree.resolveInner(defRange.from, 1);
  while (cur && cur.name !== "FootnoteDef") cur = cur.parent;
  if (!cur) return "";

  return getFootnoteDefBodyInfo(state, cur)?.bodyText ?? "";
}

export function renderFootnoteBody(bodyText: string): string {
  return renderMarkdown(bodyText);
}

/**
 * Fill `el` with renderFootnoteBody HTML. If math placeholders remain (KaTeX
 * not loaded yet), load KaTeX and repaint once, in place, only while the node
 * is still connected (same pattern as the main-doc math widgets).
 */
export function paintFootnoteBody(el: HTMLElement, bodyText: string): void {
  el.innerHTML = renderFootnoteBody(bodyText);
  if (!el.querySelector(".cm-preview-math-placeholder")) return;
  void loadKatex().then(() => {
    if (!el.isConnected) return;
    el.innerHTML = renderFootnoteBody(bodyText);
  });
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
      paintFootnoteBody(dom, body);
      return { dom };
    },
  };
}

export function footnoteTooltipExtension(): Extension {
  return hoverTooltip(footnoteTooltipSource, { hideOnChange: true });
}
