import type { EditorView } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { annotationDataField, buildAnnotationRangeMap } from "./annotationState";
import { annotationFoldField, setAllAnnotationFoldsEffect } from "./annotationWidgets";

// Bounded parse budget: on large docs the background parser may not have
// reached late annotations yet; give it a short synchronous push so they are
// included, but never block the UI for long. Extra positions beyond what the
// render path has materialized are harmless — fold state applies once the
// widget renders.
const PARSE_TIMEOUT_MS = 100;

/**
 * Collapses every multiline block annotation (callout/thread) in `view`, or
 * expands them all when every one is already collapsed. Single-line pill
 * annotations are unaffected. Returns false (without dispatching) when the
 * document has no multiline block annotations.
 */
export function toggleAllBlockAnnotationFolds(view: EditorView): boolean {
  const { state } = view;
  const annotations = state.field(annotationDataField, false) ?? [];
  if (annotations.length === 0) return false;

  // When the materialized tree already spans the whole document, reuse it
  // directly — `ensureSyntaxTree` would otherwise re-enter the parser and pay up
  // to PARSE_TIMEOUT_MS of budget on every toggle even though there is nothing
  // left to parse. Only fall back to the bounded parse push when the tree is
  // still short of the document end (late annotations past the frontier).
  const existingTree = syntaxTree(state);
  const tree = existingTree.length >= state.doc.length
    ? existingTree
    : (ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT_MS) ?? existingTree);
  const docLen = state.doc.length;
  const rangeMap = buildAnnotationRangeMap(annotations);
  const targets: number[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name !== "BlockAnnotation") return;
      const from = node.from;
      const to = node.to;
      if (from < 0 || to > docLen || from >= to) return;
      if (state.doc.lineAt(from).number === state.doc.lineAt(to).number) return;
      if (!rangeMap.has(`${from}:${to}`)) return;
      targets.push(from);
    },
  });
  if (targets.length === 0) return false;

  const foldMap = state.field(annotationFoldField, false);
  const allCollapsed = targets.every((pos) => foldMap?.get(pos) ?? false);
  view.dispatch({
    effects: setAllAnnotationFoldsEffect.of({ positions: targets, collapsed: !allCollapsed }),
  });
  return true;
}
