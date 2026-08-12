import { type EditorState, RangeSet } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { isCursorOnLine, isCursorInRange } from "./proximity";
import { ImageWidget, CalloutHeaderWidget, InlineMathWidget, DisplayMathWidget, EditableTableWidget, MermaidWidget, HorizontalRuleWidget, PageBreakWidget, EscapedDollarWidget } from "./widgets";
import { parseTable, stripQuotePrefixes } from "./table";
import { PAGE_MARKER_REGEX_SOURCE } from "../../lib/pageMarkers";
import { FootnoteRefWidget, FootnoteDefMarkWidget } from "./footnoteWidgets";
import { buildFootnoteMap, type FootnoteMap } from "./footnoteNumbering";
import { imageResolverFacet } from "./imageResolver";
import { mediaThumbnailsFacet } from "./mediaThumbnails";
import { parseCalloutType, calloutFoldField } from "./callout";
import { perfMark, perfMeasure } from "./perf";
import { getRefDefLabels, addPlainBracketDecos } from "./plainBrackets";

const headingClass: Record<string, string> = {
  ATXHeading1: "cm-preview-h1",
  ATXHeading2: "cm-preview-h2",
  ATXHeading3: "cm-preview-h3",
  ATXHeading4: "cm-preview-h4",
  ATXHeading5: "cm-preview-h5",
  ATXHeading6: "cm-preview-h6",
};

export interface BuildDecorationsResult {
  decorations: DecorationSet;
  cursorSensitiveLines: Set<number>;
}

const cursorSensitiveNodeNames = new Set([
  "StrongEmphasis", "Emphasis", "WikiLink",
  "FencedCode", "Blockquote", "InlineCode", "InlineMath",
  "InlineComment", "BlockComment", "HorizontalRule", "DisplayMath",
  "Strikethrough", "FootnoteRef", "FootnoteDef",
]);

export function buildDecorations(view: EditorView): BuildDecorationsResult {
  perfMark("buildDecorations:start");
  const { state } = view;
  const decos: { from: number; to: number; deco: Decoration }[] = [];
  const cursorSensitiveLines = new Set<number>();
  const footnoteMap = buildFootnoteMap(state);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (headingClass[node.name] || cursorSensitiveNodeNames.has(node.name)) {
          const startLine = state.doc.lineAt(node.from).number;
          const endLine = state.doc.lineAt(node.to).number;
          for (let l = startLine; l <= endLine; l++) cursorSensitiveLines.add(l);
        }
        const cls = headingClass[node.name];
        if (cls) {
          addHeadingDecos(state, node.from, node.to, cls, node.node, decos, cursorSensitiveLines, footnoteMap);
          return false;
        }
        if (node.name === "StrongEmphasis") {
          addEmphasisDecos(state, node.from, node.to, "cm-preview-bold", node.node, decos, cursorSensitiveLines, footnoteMap);
          return false;
        }
        if (node.name === "Emphasis") {
          addEmphasisDecos(state, node.from, node.to, "cm-preview-italic", node.node, decos, cursorSensitiveLines, footnoteMap);
          return false;
        }
        if (node.name === "Strikethrough") {
          addStrikethroughDecos(state, node.from, node.to, node.node, decos, cursorSensitiveLines, footnoteMap);
          return false;
        }
        if (node.name === "Image") {
          addImageDecos(state, node.from, node.to, node.node, decos, cursorSensitiveLines);
          return false;
        }
        if (node.name === "Link") {
          addLinkDecos(state, node.from, node.to, node.node, decos, cursorSensitiveLines);
          return false;
        }
        if (node.name === "FencedCode") {
          addFencedCodeDecos(state, node.from, node.to, node.node, decos);
          return false;
        }
        if (node.name === "WikiLink") {
          addWikilinkDecos(state, node.from, node.to, node.node, decos);
          return false;
        }
        if (node.name === "Blockquote") {
          const firstLine = state.doc.lineAt(node.from);
          if (parseCalloutType(firstLine.text)) {
            addCalloutDecos(state, node.from, node.to, node.node, decos);
          } else {
            addBlockquoteDecos(state, node.from, node.to, decos);
          }
        }
        if (node.name === "ListItem") {
          addListItemDecos(view, state, node.from, node.node, decos);
        }
        if (node.name === "InlineCode") {
          addInlineCodeDecos(state, node.from, node.to, node.node, decos);
          return false;
        }
        if (node.name === "InlineMath") {
          addInlineMathDecos(state, node.from, node.to, node.node, decos);
          return false;
        }
        if (node.name === "Escape") {
          // Escapes inside tables are dead decorations: the whole Table is
          // block-replaced by EditableTableWidget (cell glyphs come from
          // table.ts). Skip the widget and the cursorSensitiveLines entry so
          // caret moves across table rows do not force needless rebuilds.
          if (!hasAncestor(node.node, "Table")) {
            addEscapedDollarDecos(state, node.from, node.to, decos, cursorSensitiveLines);
          }
          return false;
        }
        if (node.name === "InlineComment") {
          addInlineCommentDecos(state, node.from, node.to, decos);
          return false;
        }
        if (node.name === "BlockComment") {
          if (!state.doc.sliceString(node.from, node.to).includes("\n")) {
            addBlockCommentDecos(state, node.from, node.to, decos);
          }
          return false;
        }
        if (node.name === "HorizontalRule") {
          addHorizontalRuleDecos(state, node.from, node.to, decos);
          return false;
        }
        if (node.name === "CommentBlock") {
          if (addPageBreakDecos(state, node.from, node.to, decos)) {
            const startLine = state.doc.lineAt(node.from).number;
            const endLine = state.doc.lineAt(node.to).number;
            for (let l = startLine; l <= endLine; l++) cursorSensitiveLines.add(l);
          }
          return false;
        }
        if (node.name === "FootnoteRef") {
          addFootnoteRefDecos(state, node.from, node.to, node.node, footnoteMap, decos);
          return false;
        }
        if (node.name === "FootnoteDef") {
          // Mark-only replace (single-line); the def body stays visible. The
          // whole def stays cursor-sensitive via cursorSensitiveNodeNames, so
          // entering any line reveals the raw marker and drops the line class.
          addFootnoteDefDecos(state, node.from, node.to, node.node, decos);
          return false; // only FootnoteDefMark child today; nothing else to walk
        }
        if (node.name === "DisplayMath") {
          if (!state.doc.sliceString(node.from, node.to).includes("\n")) {
            addDisplayMathDecos(state, node.from, node.to, decos);
          }
          return false;
        }
      },
    });
  }

  decos.sort((a, b) => a.from - b.from || a.to - b.to);

  const filtered = filterContainedDecorations(decos);

  const result = RangeSet.of(filtered.map((d) => d.deco.range(d.from, d.to)));
  perfMeasure("buildDecorations", "buildDecorations:start");
  return { decorations: result, cursorSensitiveLines };
}

function hasAncestor(
  node: { name: string; parent: { name: string; parent: unknown } | null },
  name: string,
): boolean {
  let cur = node.parent;
  while (cur) {
    if (cur.name === name) return true;
    cur = cur.parent as { name: string; parent: unknown } | null;
  }
  return false;
}

function processInlineChildren(
  state: EditorState,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
  cursorSensitiveLines: Set<number>,
  footnoteMap?: FootnoteMap,
) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "Emphasis") {
      addEmphasisDecos(state, child.from, child.to, "cm-preview-italic", child, decos, cursorSensitiveLines, footnoteMap);
    } else if (child.name === "StrongEmphasis") {
      addEmphasisDecos(state, child.from, child.to, "cm-preview-bold", child, decos, cursorSensitiveLines, footnoteMap);
    } else if (child.name === "WikiLink") {
      addWikilinkDecos(state, child.from, child.to, child, decos);
    } else if (child.name === "Link") {
      addLinkDecos(state, child.from, child.to, child, decos, cursorSensitiveLines, footnoteMap);
    } else if (child.name === "InlineCode") {
      addInlineCodeDecos(state, child.from, child.to, child, decos);
    } else if (child.name === "InlineMath") {
      addInlineMathDecos(state, child.from, child.to, child, decos);
    } else if (child.name === "Escape") {
      if (!hasAncestor(child, "Table")) {
        addEscapedDollarDecos(state, child.from, child.to, decos, cursorSensitiveLines);
      }
    } else if (child.name === "Image") {
      addImageDecos(state, child.from, child.to, child, decos);
    } else if (child.name === "InlineComment") {
      addInlineCommentDecos(state, child.from, child.to, decos);
    } else if (child.name === "Strikethrough") {
      addStrikethroughDecos(state, child.from, child.to, child, decos, cursorSensitiveLines, footnoteMap);
    } else if (child.name === "FootnoteRef" && footnoteMap) {
      addFootnoteRefDecos(state, child.from, child.to, child, footnoteMap, decos);
    }
  }
}

function addHeadingDecos(
  state: EditorState,
  from: number,
  to: number,
  cls: string,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
  cursorSensitiveLines: Set<number>,
  footnoteMap?: FootnoteMap,
) {
  if (isCursorOnLine(state, from, to)) return;

  const headerMark = node.getChild("HeaderMark");
  if (headerMark) {
    const hideEnd = headerMark.to < to && state.doc.sliceString(headerMark.to, headerMark.to + 1) === " "
      ? headerMark.to + 1
      : headerMark.to;
    decos.push({ from: headerMark.from, to: hideEnd, deco: Decoration.replace({}) });
  }

  const contentFrom = headerMark
    ? (headerMark.to < to && state.doc.sliceString(headerMark.to, headerMark.to + 1) === " " ? headerMark.to + 1 : headerMark.to)
    : from;
  if (contentFrom < to) {
    decos.push({ from: contentFrom, to, deco: Decoration.mark({ class: cls }) });
  }

  processInlineChildren(state, node, decos, cursorSensitiveLines, footnoteMap);
}

function addEscapedDollarDecos(
  state: EditorState,
  from: number,
  to: number,
  decos: { from: number; to: number; deco: Decoration }[],
  cursorSensitiveLines: Set<number>,
) {
  if (state.doc.sliceString(from, to) !== "\\$") return;
  cursorSensitiveLines.add(state.doc.lineAt(from).number);
  if (isCursorInRange(state, from, to)) return;
  decos.push({
    from,
    to,
    deco: Decoration.replace({ widget: new EscapedDollarWidget() }),
  });
}

function addEmphasisDecos(
  state: EditorState,
  from: number,
  to: number,
  cls: string,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
  cursorSensitiveLines: Set<number>,
  footnoteMap?: FootnoteMap,
) {
  if (isCursorInRange(state, from, to)) return;

  const marks = node.getChildren("EmphasisMark");
  let contentFrom = from;
  let contentTo = to;

  for (const mark of marks) {
    if (mark.from >= from && mark.to <= to) {
      decos.push({ from: mark.from, to: mark.to, deco: Decoration.replace({}) });
      if (mark.from === from) contentFrom = mark.to;
      if (mark.to === to) contentTo = mark.from;
    }
  }

  if (contentFrom < contentTo) {
    decos.push({ from: contentFrom, to: contentTo, deco: Decoration.mark({ class: cls }) });
  }

  processInlineChildren(state, node, decos, cursorSensitiveLines, footnoteMap);
}

function addStrikethroughDecos(
  state: EditorState,
  from: number,
  to: number,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
  cursorSensitiveLines: Set<number>,
  footnoteMap?: FootnoteMap,
) {
  if (isCursorInRange(state, from, to)) return;

  const marks = node.getChildren("StrikethroughMark");
  let contentFrom = from;
  let contentTo = to;

  for (const mark of marks) {
    if (mark.from >= from && mark.to <= to) {
      decos.push({ from: mark.from, to: mark.to, deco: Decoration.replace({}) });
      if (mark.from === from) contentFrom = mark.to;
      if (mark.to === to) contentTo = mark.from;
    }
  }

  if (contentFrom < contentTo) {
    decos.push({ from: contentFrom, to: contentTo, deco: Decoration.mark({ class: "cm-preview-strikethrough" }) });
  }

  processInlineChildren(state, node, decos, cursorSensitiveLines, footnoteMap);
}

function addFootnoteRefDecos(
  state: EditorState,
  from: number,
  to: number,
  node: ReturnType<typeof syntaxTree>["topNode"],
  footnoteMap: FootnoteMap,
  decos: { from: number; to: number; deco: Decoration }[],
) {
  if (isCursorInRange(state, from, to)) return;

  const marks = node.getChildren("FootnoteRefMark");
  if (marks.length < 2) return;

  const label = state.doc.sliceString(marks[0]!.to, marks[1]!.from);
  const defPos = footnoteMap.defPositions.get(label);
  const targetDefPos = defPos ? defPos.from : null;

  decos.push({
    from,
    to,
    deco: Decoration.replace({ widget: new FootnoteRefWidget(label, targetDefPos) }),
  });
}

function addFootnoteDefDecos(
  state: EditorState,
  from: number,
  to: number,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
) {
  // Any line of a multi-line def reveals the raw marker and drops the line
  // class (same proximity pattern as blockquotes / other cursor-sensitive
  // nodes).
  if (isCursorOnLine(state, from, to)) return;

  const mark = node.getChild("FootnoteDefMark");
  if (!mark) return;

  const markText = state.doc.sliceString(mark.from, mark.to);
  const m = /^\[\^([a-zA-Z0-9_-]+)\]:$/.exec(markText);
  const label = m?.[1];
  // Unparsed mark text gets no widget (skip rather than inventing a fallback).
  if (!label) return;

  // Marker + one trailing separator (never the body) - same convention as
  // headings, which swallow a single space after the HeaderMark.
  let replaceTo = mark.to;
  if (replaceTo < to) {
    const next = state.doc.sliceString(replaceTo, replaceTo + 1);
    if (next === " " || next === "\t") replaceTo += 1;
  }

  // Marker only - body stays in place, readable.
  decos.push({
    from: mark.from,
    to: replaceTo,
    deco: Decoration.replace({
      widget: new FootnoteDefMarkWidget(label),
    }),
  });

  // Modest line chrome on every line of the def.
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to);
  for (let n = first.number; n <= last.number; n++) {
    const line = state.doc.line(n);
    decos.push({
      from: line.from,
      to: line.from,
      deco: Decoration.line({ class: "cm-footnote-def" }),
    });
  }
}

function addBlockquoteDecos(
  state: EditorState,
  from: number,
  to: number,
  decos: { from: number; to: number; deco: Decoration }[],
) {
  if (isCursorOnLine(state, from, to)) return;

  const firstLine = state.doc.lineAt(from);
  const lastLine = state.doc.lineAt(to);

  for (let lineNum = firstLine.number; lineNum <= lastLine.number; lineNum++) {
    const line = state.doc.line(lineNum);
    decos.push({
      from: line.from,
      to: line.from,
      deco: Decoration.line({ class: "cm-blockquote" }),
    });
    const quoteMarkMatch = line.text.match(/^(\s*>)\s?/);
    if (quoteMarkMatch) {
      decos.push({
        from: line.from,
        to: line.from + quoteMarkMatch[0].length,
        deco: Decoration.replace({}),
      });
    }
  }
}

function addListItemDecos(
  view: EditorView,
  state: EditorState,
  from: number,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
) {
  const listMark = node.getChild("ListMark");
  if (!listMark) return;

  // Suppress list-item decorations when cursor is on a non-callout blockquote
  // list item, matching addBlockquoteDecos' bail behavior to avoid horizontal jump.
  let bq = node.parent;
  while (bq && bq.name !== "Blockquote") bq = bq.parent;
  if (bq) {
    const isCallout = !!parseCalloutType(state.doc.lineAt(bq.from).text);
    if (!isCallout && isCursorOnLine(state, from, node.to)) return;
  }

  const line = state.doc.lineAt(from);
  const task = node.getChild("Task");
  const taskMarker = task?.getChild("TaskMarker");
  const markerEnd = taskMarker?.to ?? listMark.to;
  const prefixChars = markerEnd + 1 - listMark.from;
  const indent = Math.round(prefixChars * view.defaultCharacterWidth);

  const firstLineNum = line.number;
  const lastLineNum = state.doc.lineAt(node.to).number;

  for (let lineNum = firstLineNum; lineNum <= lastLineNum; lineNum++) {
    const l = state.doc.line(lineNum);
    const cls = lineNum === firstLineNum ? "cm-list-item" : "cm-list-item-continuation";
    decos.push({
      from: l.from,
      to: l.from,
      deco: Decoration.line({
        class: cls,
        attributes: { style: `--li-indent: ${indent}px` },
      }),
    });
  }
}

function addImageDecos(
  state: EditorState,
  from: number,
  to: number,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
  cursorSensitiveLines?: Set<number>,
) {
  addPlainBracketDecos(state, from, to, node, getRefDefLabels(state), decos);

  const urlNode = node.getChild("URL");
  const src = urlNode ? state.doc.sliceString(urlNode.from, urlNode.to) : "";

  if (cursorSensitiveLines && urlNode && src) {
    const startLine = state.doc.lineAt(from).number;
    const endLine = state.doc.lineAt(to).number;
    for (let l = startLine; l <= endLine; l++) cursorSensitiveLines.add(l);
  }

  if (isCursorInRange(state, from, to)) return;

  // Alt text is between the first LinkMark "![" and the second LinkMark "]"
  const linkMarks = node.getChildren("LinkMark");
  let alt = "";
  if (linkMarks.length >= 2 && linkMarks[0] && linkMarks[1]) {
    alt = state.doc.sliceString(linkMarks[0].to, linkMarks[1].from);
  }

  if (src) {
    const resolve = state.facet(imageResolverFacet);
    const thumbnail = state.facet(mediaThumbnailsFacet);
    decos.push({
      from,
      to,
      deco: Decoration.replace({ widget: new ImageWidget(resolve(src), alt, thumbnail) }),
    });
  }
}

function addLinkDecos(
  state: EditorState,
  from: number,
  to: number,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
  cursorSensitiveLines?: Set<number>,
  footnoteMap?: FootnoteMap,
) {
  addPlainBracketDecos(state, from, to, node, getRefDefLabels(state), decos);

  const linkMarks = node.getChildren("LinkMark");
  const urlNode = node.getChild("URL");

  if (cursorSensitiveLines && linkMarks.length >= 4 && urlNode) {
    const startLine = state.doc.lineAt(from).number;
    const endLine = state.doc.lineAt(to).number;
    for (let l = startLine; l <= endLine; l++) cursorSensitiveLines.add(l);
  }

  if (isCursorInRange(state, from, to)) return;

  // Cursor is away: recurse into the label so nested inline content (\$
  // escapes, emphasis, ...) still previews, including for reference links
  // where the bracket-hide below bails (no URL node).
  processInlineChildren(
    state,
    node,
    decos,
    cursorSensitiveLines ?? new Set<number>(),
    footnoteMap,
  );

  if (linkMarks.length < 4 || !urlNode) return;

  const openBracket = linkMarks[0]!;
  const closeBracket = linkMarks[1]!;
  const closeParen = linkMarks[3]!;

  const url = state.doc.sliceString(urlNode.from, urlNode.to);

  if (openBracket.to >= closeBracket.from) return;
  decos.push({ from: openBracket.from, to: openBracket.to, deco: Decoration.replace({}) });
  decos.push({ from: closeBracket.from, to: closeParen.to, deco: Decoration.replace({}) });
  decos.push({
    from: openBracket.to,
    to: closeBracket.from,
    deco: Decoration.mark({ class: "cm-preview-link", attributes: { "data-url": url } }),
  });
}

function addFencedCodeDecos(
  state: EditorState,
  from: number,
  to: number,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
) {
  const codeMarks = node.getChildren("CodeMark");
  const codeInfo = node.getChild("CodeInfo");
  if (codeInfo && state.doc.sliceString(codeInfo.from, codeInfo.to).trim().toLowerCase() === "mermaid") return;

  const cursorOnBlock = isCursorOnLine(state, from, to);
  const codeText = node.getChild("CodeText");

  const openMark = codeMarks[0];
  if (openMark) {
    const openEnd = codeInfo ? codeInfo.to : openMark.to;
    const line = state.doc.lineAt(openEnd);
    if (!cursorOnBlock) {
      decos.push({ from: openMark.from, to: line.to, deco: Decoration.replace({}) });
    }
    decos.push({ from: line.from, to: line.from, deco: Decoration.line({ class: "cm-code-fence-top" }) });
  }

  const closeMark = codeMarks.length >= 2 ? codeMarks[codeMarks.length - 1] : undefined;
  if (closeMark) {
    const line = state.doc.lineAt(closeMark.from);
    if (!cursorOnBlock) {
      decos.push({ from: line.from, to: closeMark.to, deco: Decoration.replace({}) });
    }
    decos.push({ from: line.from, to: line.from, deco: Decoration.line({ class: "cm-code-fence-bottom" }) });
  }

  if (codeText) {
    const firstLine = state.doc.lineAt(codeText.from);
    const lastLine = state.doc.lineAt(codeText.to);
    for (let lineNum = firstLine.number; lineNum <= lastLine.number; lineNum++) {
      const line = state.doc.line(lineNum);
      decos.push({ from: line.from, to: line.from, deco: Decoration.line({ class: "cm-preview-code-block" }) });
    }
  }
}

function addWikilinkDecos(
  state: EditorState,
  from: number,
  to: number,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
) {
  if (isCursorInRange(state, from, to)) return;

  const marks = node.getChildren("WikiLinkMark");
  if (marks.length < 2) return;

  const openMark = marks[0]!;
  const closeMark = marks[1]!;

  const content = state.doc.sliceString(openMark.to, closeMark.from);
  const pipeIndex = content.indexOf("|");

  if (pipeIndex >= 0) {
    const pipePos = openMark.to + pipeIndex;
    const displayFrom = pipePos + 1;
    if (displayFrom >= closeMark.from) return;
    decos.push({ from: openMark.from, to: displayFrom, deco: Decoration.replace({}) });
    decos.push({ from: displayFrom, to: closeMark.from, deco: Decoration.mark({ class: "cm-preview-wikilink" }) });
    decos.push({ from: closeMark.from, to: closeMark.to, deco: Decoration.replace({}) });
  } else {
    if (openMark.to >= closeMark.from) return;
    decos.push({ from: openMark.from, to: openMark.to, deco: Decoration.replace({}) });
    decos.push({ from: openMark.to, to: closeMark.from, deco: Decoration.mark({ class: "cm-preview-wikilink" }) });
    decos.push({ from: closeMark.from, to: closeMark.to, deco: Decoration.replace({}) });
  }
}

function addCalloutDecos(
  state: EditorState,
  from: number,
  to: number,
  _node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
) {
  const firstLine = state.doc.lineAt(from);
  const calloutInfo = parseCalloutType(firstLine.text);
  if (!calloutInfo) return;

  const cursorLine = state.doc.lineAt(state.selection.main.head).number;

  const foldState = state.field(calloutFoldField, false);
  const flipped = foldState?.get(from) ?? false;
  const defaultCollapsed = calloutInfo.fold === "collapsed";
  const isCollapsed = flipped ? !defaultCollapsed : defaultCollapsed;

  const resolvedType = calloutInfo.resolvedType;
  const title = calloutInfo.title ?? calloutInfo.type.charAt(0).toUpperCase() + calloutInfo.type.slice(1);

  const firstLineNum = firstLine.number;
  const lastLine = state.doc.lineAt(to);
  const lastLineNum = lastLine.number;

  // Line decoration for the header line (always applied). The header line is
  // also the visual bottom edge when collapsed or when the callout has no body.
  const headerIsLast = isCollapsed || lastLineNum === firstLineNum;
  decos.push({
    from: firstLine.from,
    to: firstLine.from,
    deco: Decoration.line({
      class: `cm-callout cm-callout-${resolvedType} cm-callout-first${headerIsLast ? " cm-callout-last" : ""}`,
    }),
  });

  // Replace header line content with widget (only when cursor is not on header)
  if (cursorLine !== firstLineNum) {
    decos.push({
      from: firstLine.from,
      to: firstLine.to,
      deco: Decoration.replace({
        widget: new CalloutHeaderWidget(resolvedType, title, isCollapsed, calloutInfo.fold !== null, from),
      }),
    });
  }

  if (isCollapsed) {
    // Body hiding is done by blockReplacementField (StateField) since it crosses line breaks.
  } else {
    // Expanded: style body lines, hide quote marks per-line
    for (let lineNum = firstLineNum + 1; lineNum <= lastLineNum; lineNum++) {
      const line = state.doc.line(lineNum);
      decos.push({
        from: line.from,
        to: line.from,
        deco: Decoration.line({
          class: `cm-callout cm-callout-${resolvedType}${lineNum === lastLineNum ? " cm-callout-last" : ""}`,
        }),
      });
      const quoteMarkMatch = line.text.match(/^(\s*>)\s?/);
      if (quoteMarkMatch) {
        decos.push({
          from: line.from,
          to: line.from + quoteMarkMatch[0].length,
          deco: Decoration.replace({}),
        });
      }
    }
  }
}

function addInlineCodeDecos(
  state: EditorState,
  from: number,
  to: number,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
) {
  const cursorInside = isCursorInRange(state, from, to);

  const marks = node.getChildren("CodeMark");
  let contentFrom = from;
  let contentTo = to;

  for (const mark of marks) {
    if (mark.from >= from && mark.to <= to) {
      if (!cursorInside) {
        decos.push({ from: mark.from, to: mark.to, deco: Decoration.replace({}) });
      }
      if (mark.from === from) contentFrom = mark.to;
      if (mark.to === to) contentTo = mark.from;
    }
  }

  if (contentFrom < contentTo) {
    decos.push({ from: contentFrom, to: contentTo, deco: Decoration.mark({ class: "cm-preview-code-inline" }) });
  }
}

function addInlineMathDecos(
  state: EditorState,
  from: number,
  to: number,
  node: { getChildren(type: string): { from: number; to: number }[] },
  decos: { from: number; to: number; deco: Decoration }[],
) {
  if (isCursorInRange(state, from, to)) return;

  const marks = node.getChildren("InlineMathMark");
  if (marks.length < 2) return;

  const latex = state.doc.sliceString(marks[0]!.to, marks[1]!.from);
  decos.push({
    from,
    to,
    deco: Decoration.replace({ widget: new InlineMathWidget(latex) }),
  });
}

function addDisplayMathDecos(
  state: EditorState,
  from: number,
  to: number,
  decos: { from: number; to: number; deco: Decoration }[],
) {
  if (isCursorOnLine(state, from, to)) return;

  let latex = state.doc.sliceString(from, to);
  if (latex.startsWith("$$")) {
    latex = latex.slice(2);
    if (latex.endsWith("$$")) latex = latex.slice(0, -2);
  } else if (latex.startsWith("\\[")) {
    latex = latex.slice(2);
    if (latex.endsWith("\\]")) latex = latex.slice(0, -2);
  }
  latex = latex.trim();

  decos.push({
    from,
    to,
    deco: Decoration.replace({ widget: new DisplayMathWidget(latex) }),
  });
}

export interface BlockReplacementState {
  decos: DecorationSet;
  cursorSensitiveRanges: Array<{ fromLine: number; toLine: number }>;
}

/**
 * Line-break-crossing replacements that must be provided via a StateField,
 * not a ViewPlugin (CodeMirror restriction).
 */
export function buildBlockReplacements(state: EditorState): BlockReplacementState {
  perfMark("buildBlockReplacements:start");
  const decos: { from: number; to: number; deco: Decoration }[] = [];
  const cursorSensitiveRanges: Array<{ fromLine: number; toLine: number }> = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "Blockquote") {
        addCollapsedCalloutBody(state, node.from, node.to, decos);
        const firstLine = state.doc.lineAt(node.from);
        if (parseCalloutType(firstLine.text)) {
          cursorSensitiveRanges.push({
            fromLine: firstLine.number,
            toLine: state.doc.lineAt(node.to).number,
          });
        }
      }
      if (node.name === "DisplayMath") {
        const text = state.doc.sliceString(node.from, node.to);
        if (text.includes("\n")) {
          addDisplayMathDecos(state, node.from, node.to, decos);
          cursorSensitiveRanges.push({
            fromLine: state.doc.lineAt(node.from).number,
            toLine: state.doc.lineAt(node.to).number,
          });
        }
      }
      if (node.name === "BlockComment") {
        const text = state.doc.sliceString(node.from, node.to);
        if (text.includes("\n")) {
          addBlockCommentDecos(state, node.from, node.to, decos);
          cursorSensitiveRanges.push({
            fromLine: state.doc.lineAt(node.from).number,
            toLine: state.doc.lineAt(node.to).number,
          });
        }
      }
      if (node.name === "Table") {
        addTableBlockReplacement(state, node.from, node.to, decos);
      }
      if (node.name === "FencedCode") {
        const codeInfo = node.node.getChild("CodeInfo");
        if (codeInfo) {
          const lang = state.doc.sliceString(codeInfo.from, codeInfo.to).trim().toLowerCase();
          if (lang === "mermaid") {
            addMermaidBlockReplacement(state, node.from, node.to, node.node, decos);
            cursorSensitiveRanges.push({
              fromLine: state.doc.lineAt(node.from).number,
              toLine: state.doc.lineAt(node.to).number,
            });
          }
        }
      }
    },
  });

  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  const result = RangeSet.of(decos.map((d) => d.deco.range(d.from, d.to)));
  perfMeasure("buildBlockReplacements", "buildBlockReplacements:start");
  return { decos: result, cursorSensitiveRanges };
}

export function filterContainedDecorations(
  decos: { from: number; to: number; deco: Decoration }[],
): { from: number; to: number; deco: Decoration }[] {
  const widgetReplaces: { from: number; to: number }[] = [];
  for (const d of decos) {
    if (d.deco.spec.widget && d.from < d.to) {
      widgetReplaces.push(d);
    }
  }
  if (widgetReplaces.length === 0) return decos;

  let w = 0;
  const result: typeof decos = [];
  for (const d of decos) {
    if (d.deco.spec.widget || d.from === d.to) {
      result.push(d);
      continue;
    }
    while (w < widgetReplaces.length && widgetReplaces[w]!.to < d.from) {
      w++;
    }
    if (
      w < widgetReplaces.length &&
      widgetReplaces[w]!.from <= d.from &&
      widgetReplaces[w]!.to >= d.to
    ) {
      continue;
    }
    result.push(d);
  }
  return result;
}

function addCollapsedCalloutBody(
  state: EditorState,
  from: number,
  to: number,
  decos: { from: number; to: number; deco: Decoration }[],
) {
  const firstLine = state.doc.lineAt(from);
  const calloutInfo = parseCalloutType(firstLine.text);
  if (!calloutInfo) return;
  if (isCursorOnLine(state, from, to)) return;

  const foldState = state.field(calloutFoldField, false);
  const flipped = foldState?.get(from) ?? false;
  const defaultCollapsed = calloutInfo.fold === "collapsed";
  const isCollapsed = flipped ? !defaultCollapsed : defaultCollapsed;
  if (!isCollapsed) return;

  const firstLineNum = firstLine.number;
  const lastLine = state.doc.lineAt(to);
  if (firstLineNum < lastLine.number) {
    decos.push({
      from: firstLine.to,
      to,
      deco: Decoration.replace({}),
    });
  }
}

function addTableBlockReplacement(
  state: EditorState,
  from: number,
  to: number,
  decos: { from: number; to: number; deco: Decoration }[],
) {
  const raw = state.doc.sliceString(from, to);
  const { text, prefixes } = stripQuotePrefixes(raw);
  if (!parseTable(text)) return;
  decos.push({
    from,
    to,
    deco: Decoration.replace({ widget: new EditableTableWidget(text, from, raw.length, prefixes) }),
  });
}

function addMermaidBlockReplacement(
  state: EditorState,
  from: number,
  to: number,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
) {
  if (isCursorOnLine(state, from, to)) return;

  const codeText = node.getChild("CodeText");
  if (!codeText) return;

  const source = state.doc.sliceString(codeText.from, codeText.to);
  const theme = document.documentElement.classList.contains("dark") ? "dark" : "default";
  const thumbnail = state.facet(mediaThumbnailsFacet);
  decos.push({
    from,
    to,
    deco: Decoration.replace({ widget: new MermaidWidget(source, theme, thumbnail) }),
  });
}

function addInlineCommentDecos(
  state: EditorState,
  from: number,
  to: number,
  decos: { from: number; to: number; deco: Decoration }[],
) {
  if (isCursorOnLine(state, from, to)) return;
  decos.push({ from, to, deco: Decoration.mark({ class: "cm-preview-comment" }) });
}

function addHorizontalRuleDecos(
  state: EditorState,
  from: number,
  to: number,
  decos: { from: number; to: number; deco: Decoration }[],
) {
  if (isCursorOnLine(state, from, to)) return;
  const raw = state.doc.sliceString(from, to).replace(/\s/g, "");
  const variant = raw === "---" ? "short" : "full";
  decos.push({
    from,
    to,
    deco: Decoration.replace({ widget: new HorizontalRuleWidget(variant) }),
  });
}

function addBlockCommentDecos(
  state: EditorState,
  from: number,
  to: number,
  decos: { from: number; to: number; deco: Decoration }[],
) {
  if (isCursorOnLine(state, from, to)) return;
  decos.push({ from, to, deco: Decoration.mark({ class: "cm-preview-comment" }) });
}

const pageBreakRegex = new RegExp(`^${PAGE_MARKER_REGEX_SOURCE}$`);

function addPageBreakDecos(
  state: EditorState,
  from: number,
  to: number,
  decos: { from: number; to: number; deco: Decoration }[],
): boolean {
  const text = state.doc.sliceString(from, to).trim();
  const match = pageBreakRegex.exec(text);
  if (!match) return false;
  if (isCursorOnLine(state, from, to)) return true;
  const pageNum = parseInt(match[1]!, 10);
  decos.push({
    from,
    to,
    deco: Decoration.replace({ widget: new PageBreakWidget(pageNum) }),
  });
  return true;
}

