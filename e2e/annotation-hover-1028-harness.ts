import { EditorState, Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createExtensions } from "../src/editor/extensions";
import { setAnnotationData } from "../src/editor/livePreview/annotationState";
import { scopeHighlightField } from "../src/editor/livePreview/scopeHighlight";
import { DOC, PARSED_ANNOTATIONS } from "./annotation-hover-1028-fixture";
import "../src/index.css";

// Exact fixture from issue #1028 - shared with the spec via
// annotation-hover-1028-fixture.ts (DOC, PARSED_ANNOTATIONS).

const view = new EditorView({
  state: EditorState.create({
    doc: DOC,
    selection: { anchor: 0 },
    extensions: createExtensions({
      theme: "light",
      themeCompartment: new Compartment(),
      keymapCompartment: new Compartment(),
      foldCompartment: new Compartment(),
      crossrefCompartment: new Compartment(),
      noteDirCompartment: new Compartment(),
      notePathCompartment: new Compartment(),
      imageResolverCompartment: new Compartment(),
      mediaThumbnailsCompartment: new Compartment(),
      annotationCompartment: new Compartment(),
      annotationEnabled: true,
      focusModeCompartment: new Compartment(),
      editableCompartment: new Compartment(),
      openUrl: () => {},
    }),
  }),
  parent: document.getElementById("harness-root")!,
});

view.dispatch({ effects: setAnnotationData.of(PARSED_ANNOTATIONS) });

export interface HoverState {
  highlight: { from: number; to: number } | null;
  pillCount: number;
  pillTexts: string[];
  domHighlights: string[];
}

declare global {
  interface Window {
    __HOVER__: {
      ready: boolean;
      state(): HoverState;
      doc(): string;
      /** Re-dispatch setAnnotationData with uuids (simulates enrichment rebuild). */
      enrich(): void;
      /** Simulate a widget rebuild while the pointer is stationary. */
      rebuild(): void;
    };
  }
}

window.__HOVER__ = {
  ready: true,
  state() {
    const decos = view.state.field(scopeHighlightField);
    let highlight: { from: number; to: number } | null = null;
    if (decos !== null) {
      const iter = decos.iter();
      if (iter.value) highlight = { from: iter.from, to: iter.to };
    }
    const pills = Array.from(view.contentDOM.querySelectorAll(".cm-annotation-pill"));
    const domHighlights = Array.from(view.contentDOM.querySelectorAll(".scope-highlight")).map(
      (el) => el.textContent ?? "",
    );
    return {
      highlight,
      pillCount: pills.length,
      pillTexts: pills.map((p) => p.textContent ?? ""),
      domHighlights,
    };
  },
  doc() {
    return view.state.doc.toString();
  },
  enrich() {
    const enriched = PARSED_ANNOTATIONS.map((a, i) => ({
      ...a,
      uuid: `uuid-${i}`,
    }));
    view.dispatch({ effects: setAnnotationData.of(enriched) });
  },
  rebuild() {
    // Fresh objects (like a re-parse) with the SAME values: eq() true path.
    const fresh = PARSED_ANNOTATIONS.map((a) => ({ ...a }));
    view.dispatch({ effects: setAnnotationData.of(fresh) });
  },
};
