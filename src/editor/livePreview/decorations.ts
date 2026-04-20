import { type EditorState, RangeSet } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { isCursorOnLine } from "./proximity";
import { ImageWidget } from "./widgets";
import { imageResolverFacet } from "./imageResolver";

const headingClass: Record<string, string> = {
  ATXHeading1: "cm-preview-h1",
  ATXHeading2: "cm-preview-h2",
  ATXHeading3: "cm-preview-h3",
  ATXHeading4: "cm-preview-h4",
  ATXHeading5: "cm-preview-h5",
  ATXHeading6: "cm-preview-h6",
};

export function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const decos: { from: number; to: number; deco: Decoration }[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const cls = headingClass[node.name];
        if (cls) {
          addHeadingDecos(state, node.from, node.to, cls, node.node, decos);
          return false;
        }
        if (node.name === "StrongEmphasis") {
          addEmphasisDecos(state, node.from, node.to, "cm-preview-bold", node.node, decos);
          return false;
        }
        if (node.name === "Emphasis") {
          addEmphasisDecos(state, node.from, node.to, "cm-preview-italic", node.node, decos);
          return false;
        }
        if (node.name === "Image") {
          addImageDecos(state, node.from, node.to, node.node, decos);
          return false;
        }
        if (node.name === "Link") {
          addLinkDecos(state, node.from, node.to, node.node, decos);
          return false;
        }
        if (node.name === "FencedCode") {
          addFencedCodeDecos(state, node.from, node.to, node.node, decos);
          return false;
        }
      },
    });
  }

  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  return RangeSet.of(decos.map((d) => d.deco.range(d.from, d.to)));
}

function addHeadingDecos(
  state: EditorState,
  from: number,
  to: number,
  cls: string,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
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
}

function addEmphasisDecos(
  state: EditorState,
  from: number,
  to: number,
  cls: string,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
) {
  if (isCursorOnLine(state, from, to)) return;

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

  // Recurse into nested emphasis/strong
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "Emphasis") {
      addEmphasisDecos(state, child.from, child.to, "cm-preview-italic", child, decos);
    } else if (child.name === "StrongEmphasis") {
      addEmphasisDecos(state, child.from, child.to, "cm-preview-bold", child, decos);
    }
  }
}

function addImageDecos(
  state: EditorState,
  from: number,
  to: number,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
) {
  if (isCursorOnLine(state, from, to)) return;

  const urlNode = node.getChild("URL");
  const src = urlNode ? state.doc.sliceString(urlNode.from, urlNode.to) : "";

  // Alt text is between the first LinkMark "![" and the second LinkMark "]"
  const linkMarks = node.getChildren("LinkMark");
  let alt = "";
  if (linkMarks.length >= 2 && linkMarks[0] && linkMarks[1]) {
    alt = state.doc.sliceString(linkMarks[0].to, linkMarks[1].from);
  }

  if (src) {
    const resolve = state.facet(imageResolverFacet);
    decos.push({
      from,
      to,
      deco: Decoration.replace({ widget: new ImageWidget(resolve(src), alt) }),
    });
  }
}

function addLinkDecos(
  state: EditorState,
  from: number,
  to: number,
  node: ReturnType<typeof syntaxTree>["topNode"],
  decos: { from: number; to: number; deco: Decoration }[],
) {
  if (isCursorOnLine(state, from, to)) return;

  const linkMarks = node.getChildren("LinkMark");
  const urlNode = node.getChild("URL");
  if (linkMarks.length < 4 || !urlNode) return;

  const openBracket = linkMarks[0]!;
  const closeBracket = linkMarks[1]!;
  const closeParen = linkMarks[3]!;

  const url = state.doc.sliceString(urlNode.from, urlNode.to);

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
  if (isCursorOnLine(state, from, to)) return;

  const codeMarks = node.getChildren("CodeMark");
  const codeInfo = node.getChild("CodeInfo");
  const codeText = node.getChild("CodeText");

  // Hide opening fence line (CodeMark + CodeInfo + newline)
  const openMark = codeMarks[0];
  if (openMark) {
    const openEnd = codeInfo ? codeInfo.to : openMark.to;
    const lineEnd = state.doc.lineAt(openEnd).to;
    decos.push({ from: openMark.from, to: Math.min(lineEnd + 1, to), deco: Decoration.replace({}) });
  }

  const closeMark = codeMarks.length >= 2 ? codeMarks[codeMarks.length - 1] : undefined;
  if (closeMark) {
    const lineStart = state.doc.lineAt(closeMark.from).from;
    decos.push({ from: Math.max(lineStart - 1, from), to: closeMark.to, deco: Decoration.replace({}) });
  }

  // Mark code content
  if (codeText) {
    decos.push({ from: codeText.from, to: codeText.to, deco: Decoration.mark({ class: "cm-preview-code-block" }) });
  }
}
