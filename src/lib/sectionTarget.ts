import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { extractHeadings } from "./headings";
import { findBlockAnchor } from "./blockAnchors";
import { dispatchFlashHighlight } from "../editor/livePreview/flashHighlight";

export interface SectionTarget {
  pos: number;
  flash: { from: number; to: number } | null;
}

export function resolvePendingSection(
  docText: string,
  section: string,
): SectionTarget | null {
  if (section.startsWith("^")) {
    const anchor = findBlockAnchor(docText, section.slice(1));
    if (!anchor) return null;
    const lineStart = docText.lastIndexOf("\n", anchor.from - 1) + 1;
    const newlineAfter = docText.indexOf("\n", anchor.from);
    const lineEnd = newlineAfter === -1 ? docText.length : newlineAfter;
    return { pos: lineStart, flash: { from: lineStart, to: lineEnd } };
  }

  const match = extractHeadings(docText).find(
    (h) => h.text.toLowerCase() === section.toLowerCase(),
  );
  if (!match) return null;
  return { pos: match.from, flash: null };
}

/**
 * Scroll the view to a `#Heading` / `#^anchor` section: cursor + scroll to the
 * target, plus a flash highlight for block anchors. No-op when the section
 * doesn't resolve in the current doc.
 */
export function applySectionToView(view: EditorView, section: string): void {
  const target = resolvePendingSection(view.state.doc.toString(), section);
  if (!target) return;
  view.dispatch({
    selection: EditorSelection.cursor(target.pos),
    effects: EditorView.scrollIntoView(target.pos, { y: "start" }),
  });
  if (target.flash) {
    dispatchFlashHighlight(view, target.flash.from, target.flash.to);
  }
}
