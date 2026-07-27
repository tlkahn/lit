import { EditorView } from "@codemirror/view";
import { annotationDataField } from "./annotationState";
import { annotationFoldField, setAllAnnotationFoldsEffect } from "./annotationWidgets";
import { isPerfEnabled } from "./perf";

export function toggleAllBlockAnnotationFolds(view: EditorView): boolean {
  const t0 = isPerfEnabled() ? performance.now() : 0;

  const annotations = view.state.field(annotationDataField);
  if (annotations.length === 0) return false;

  const doc = view.state.doc;
  const docLen = doc.length;

  const targets: number[] = [];
  for (const ann of annotations) {
    const from = ann.char_start;
    const to = ann.char_end;
    if (from < 0 || to > docLen || from >= to) continue;
    if (doc.lineAt(from).from !== from) continue;
    if (doc.lineAt(from).number === doc.lineAt(to).number) continue;
    targets.push(from);
  }

  if (targets.length === 0) return false;

  const foldMap = view.state.field(annotationFoldField, false);
  const allCollapsed = targets.every((pos) => foldMap?.get(pos) ?? false);

  const t1 = isPerfEnabled() ? performance.now() : 0;

  view.dispatch({
    effects: setAllAnnotationFoldsEffect.of({
      positions: targets,
      collapsed: !allCollapsed,
    }),
  });

  if (isPerfEnabled()) {
    const t2 = performance.now();
    console.log(
      `[perf] toggleAllBlockAnnotationFolds: collect=${(t1 - t0).toFixed(1)}ms dispatch=${(t2 - t1).toFixed(1)}ms total=${(t2 - t0).toFixed(1)}ms targets=${targets.length}`,
    );
  }

  return true;
}
