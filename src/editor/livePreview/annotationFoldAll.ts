import type { EditorView } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { annotationDataField, findAnnotationForRange } from "./annotationState";
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

  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT_MS) ?? syntaxTree(state);
  const docLen = state.doc.length;
  const targets: number[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name !== "BlockAnnotation") return;
      const from = node.from;
      const to = node.to;
      if (from < 0 || to > docLen || from >= to) return;
      if (!state.doc.sliceString(from, to).includes("\n")) return;
      if (!findAnnotationForRange(annotations, from, to)) return;
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
