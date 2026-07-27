import { EditorView } from "@codemirror/view";
import { annotationDataField } from "./annotationState";
import { annotationFoldField, setAllAnnotationFoldsEffect } from "./annotationWidgets";
import { isPerfEnabled } from "./perf";

export function isFoldAllTarget(
  doc: { length: number; lineAt(pos: number): { from: number; number: number } },
  ann: { char_start: number; char_end: number },
): boolean {
  const from = ann.char_start;
  const to = ann.char_end;
  if (from < 0 || to > doc.length || from >= to) return false;
  const startLine = doc.lineAt(from);
  if (startLine.from !== from) return false;
  return startLine.number !== doc.lineAt(to).number;
}

export function toggleAllBlockAnnotationFolds(view: EditorView): boolean {
  const t0 = isPerfEnabled() ? performance.now() : 0;

  const annotations = view.state.field(annotationDataField);
  if (annotations.length === 0) return false;

  const doc = view.state.doc;

  const targets: number[] = [];
  for (const ann of annotations) {
    if (!isFoldAllTarget(doc, ann)) continue;
    targets.push(ann.char_start);
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
