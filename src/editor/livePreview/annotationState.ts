import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type ViewUpdate, keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { parseAnnotations, type Annotation } from "../../lib/ipc";
import { isCursorOnLine } from "./proximity";
import { PillWidget, MarkerWidget, CalloutWidget, annotationFoldField } from "./annotationWidgets";
import { scopeHighlightExtension } from "./scopeHighlight";
import { escapeAnnotationKeymap } from "./escapeAnnotation";

export type DisplayMode = "pill" | "footnote";

export const setDisplayMode = StateEffect.define<DisplayMode>();

export const displayModeField = StateField.define<DisplayMode>({
  create: () => "pill",
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setDisplayMode)) return e.value;
    }
    return value;
  },
});

export const setAnnotationData = StateEffect.define<Annotation[]>();

export const annotationDataField = StateField.define<Annotation[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setAnnotationData)) return e.value;
    }
    return value;
  },
});

export const annotationPlugin = ViewPlugin.fromClass(
  class {
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private lastDocStr = "";

    constructor(private view: EditorView) {
      this.lastDocStr = view.state.doc.toString();
      this.fireIPC();
    }

    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      this.scheduleIPC();
    }

    private scheduleIPC() {
      if (this.debounceTimer != null) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.fireIPC();
      }, 150);
    }

    private fireIPC() {
      const docStr = this.view.state.doc.toString();
      this.lastDocStr = docStr;
      parseAnnotations(docStr)
        .then((annotations) => {
          if (this.view.state.doc.toString() !== this.lastDocStr) return;
          this.view.dispatch({ effects: setAnnotationData.of(annotations) });
          window.dispatchEvent(new CustomEvent("lit:annotations-changed"));
        })
        .catch(() => {});
    }

    destroy() {
      if (this.debounceTimer != null) clearTimeout(this.debounceTimer);
    }
  },
);

function findAnnotationForRange(
  annotations: Annotation[],
  from: number,
  to: number,
): Annotation | undefined {
  return annotations.find(
    (a) => a.char_start === from && a.char_end === to,
  );
}

export const annotationDecorationProvider = EditorView.decorations.compute(
  [annotationDataField, annotationFoldField, displayModeField, "selection"],
  (state) => {
    const annotations = state.field(annotationDataField);
    if (annotations.length === 0) return Decoration.none;
    const mode = state.field(displayModeField);

    const docLen = state.doc.length;
    const decos: { from: number; to: number; deco: Decoration }[] = [];

    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name !== "InlineAnnotation" && node.name !== "BlockAnnotation") return;

        const from = node.from;
        const to = node.to;
        if (from < 0 || to > docLen || from >= to) return;
        if (isCursorOnLine(state, from, to)) return;

        const ann = findAnnotationForRange(annotations, from, to);
        if (!ann) return;

        const text = state.doc.sliceString(from, to);
        const isMultiLine = text.includes("\n");

        if (node.name === "BlockAnnotation" && isMultiLine) {
          const foldState = state.field(annotationFoldField, false);
          const isCollapsed = foldState?.get(from) ?? false;
          decos.push({
            from,
            to,
            deco: Decoration.replace({
              widget: new CalloutWidget(ann, isCollapsed, from),
            }),
          });
        } else {
          const widget = mode === "footnote" ? new MarkerWidget(ann) : new PillWidget(ann);
          decos.push({
            from,
            to,
            deco: Decoration.replace({ widget }),
          });
        }
      },
    });

    decos.sort((a, b) => a.from - b.from || a.to - b.to);
    return Decoration.set(decos.map((d) => d.deco.range(d.from, d.to)));
  },
);

export function annotationExtension(): Extension {
  return [
    displayModeField,
    annotationDataField,
    annotationPlugin,
    annotationDecorationProvider,
    annotationFoldField,
    scopeHighlightExtension(),
    keymap.of(escapeAnnotationKeymap),
  ];
}
