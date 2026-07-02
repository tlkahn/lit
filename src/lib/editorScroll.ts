import type { Text } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { frontmatterLineCount } from "./pathUtils";

export function adjustLineForFrontmatter(
  line: number,
  fileAbsolute: boolean,
  rawYaml: string | null,
): number {
  if (fileAbsolute && rawYaml) {
    return Math.max(1, line - frontmatterLineCount(rawYaml));
  }
  return line;
}

export function resolveLineColPos(doc: Text, line: number, col: number): number {
  const lineNum = Math.min(line, doc.lines);
  const lineObj = doc.line(lineNum);
  return lineObj.from + Math.min(col, lineObj.length);
}

export function scrollViewToPos(
  view: EditorView,
  pos: number,
  y: "start" | "center" = "start",
): void {
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    effects: EditorView.scrollIntoView(pos, { y }),
  });
}

export function applyJumpLine(view: EditorView, jumpLine: number): void {
  const pos = resolveLineColPos(view.state.doc, jumpLine, 0);
  scrollViewToPos(view, pos, "start");
}

export function applyPendingCursorLine(
  view: EditorView,
  pendingCursorLine: number,
  pendingCursorCol: number | null,
  pendingCursorFileAbsolute: boolean,
  rawYaml: string | null,
): void {
  const adjustedLine = adjustLineForFrontmatter(pendingCursorLine, pendingCursorFileAbsolute, rawYaml);
  const pos = resolveLineColPos(view.state.doc, adjustedLine, pendingCursorCol ?? 0);
  scrollViewToPos(view, pos, "center");
}
