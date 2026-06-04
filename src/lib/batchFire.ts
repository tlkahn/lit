import type { EditorView } from "@codemirror/view";
import { canFire } from "./fireClassification";
import { annotationDataField } from "../editor/livePreview/annotationState";
import { useModalLockStore } from "../stores/modalLock";
import { fireAnnotation } from "./fireOrchestrator";

export async function batchFireReplacingAnnotations(view: EditorView): Promise<void> {
  if (useModalLockStore.getState().llmLocked) return;

  const annotations = view.state.field(annotationDataField, false) ?? [];
  const replacing = annotations
    .filter((a) => canFire(a.annotation_type))
    .sort((a, b) => b.char_start - a.char_start);

  if (replacing.length === 0) return;

  for (const ann of replacing) {
    await fireAnnotation({ view, annotation: ann });
  }
}
