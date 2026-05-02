import type { KeyBinding } from "@codemirror/view";
import { annotationDataField } from "./annotationState";
import { clearScopeHighlight } from "./scopeHighlight";

export const escapeAnnotationKeymap: KeyBinding[] = [
  {
    key: "Escape",
    run(view) {
      const sel = view.state.selection.main;
      if (sel.from !== sel.to) return false;

      const head = sel.head;
      const annotations = view.state.field(annotationDataField);
      const enclosing = annotations.find(
        (a) => head >= a.char_start && head <= a.char_end,
      );
      if (!enclosing) return false;

      const target = Math.min(enclosing.char_end + 2, view.state.doc.length);
      view.dispatch({ selection: { anchor: target } });
      clearScopeHighlight(view);
      return true;
    },
  },
];
