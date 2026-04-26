import { Facet, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { findSentenceAt } from "./sentenceBoundary";

export const focusModeFacet: Facet<boolean, boolean> = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

const unfocusedMark = Decoration.mark({ class: "cm-unfocused" });

function buildDecorations(view: EditorView): DecorationSet {
  if (!view.state.facet(focusModeFacet)) return Decoration.none;

  const pos = view.state.selection.main.head;
  const doc = view.state.doc;
  const text = doc.toString();
  const sentence = findSentenceAt(text, pos);

  const builder: { from: number; to: number }[] = [];

  if (sentence.from > 0) {
    builder.push({ from: 0, to: sentence.from });
  }
  if (sentence.to < doc.length) {
    builder.push({ from: sentence.to, to: doc.length });
  }

  if (builder.length === 0) return Decoration.none;

  return Decoration.set(
    builder.map((r) => unfocusedMark.range(r.from, r.to)),
    true,
  );
}

const focusModePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.selectionSet ||
        update.docChanged ||
        update.startState.facet(focusModeFacet) !== update.state.facet(focusModeFacet)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const focusModeTheme = EditorView.baseTheme({
  ".cm-unfocused": {
    opacity: "0.25",
    transition: "opacity 120ms ease",
  },
});

const focusModeEditorAttributes = EditorView.editorAttributes.of((view) => {
  if (view.state.facet(focusModeFacet)) {
    return { class: "cm-focus-mode" };
  }
  return null;
});

const typewriterScroll = EditorView.updateListener.of((update) => {
  if (!update.state.facet(focusModeFacet)) return;
  if (!update.selectionSet && !update.docChanged) return;

  const pos = update.state.selection.main.head;
  requestAnimationFrame(() => {
    update.view.dispatch({
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
  });
});

export function focusModeExtension(active: boolean): Extension[] {
  return [
    focusModeFacet.of(active),
    focusModePlugin,
    focusModeTheme,
    focusModeEditorAttributes,
    typewriterScroll,
  ];
}
