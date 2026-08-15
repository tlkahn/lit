import { EditorState, Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createExtensions } from "../src/editor/extensions";
import { setAnnotationData } from "../src/editor/livePreview/annotationState";
import { scopeHighlightField } from "../src/editor/livePreview/scopeHighlight";
import type { Annotation } from "../src/lib/ipc";
import "../src/index.css";

// Exact fixture from issue #1028.
export const DOC = [
  "First term alpha appears here.",
  "",
  '<!--- n: ^"alpha"',
  "---",
  "note about alpha",
  "--->",
  "",
  "Second term beta appears here.",
  "",
  '<!--- n: ^"beta"',
  "---",
  "note about beta",
  "--->",
].join("\n");

// Offsets verified against the real lit-annotation-core parser:
const ANN1_START = DOC.indexOf('<!--- n: ^"alpha"');
const ANN1_END = ANN1_START + '<!--- n: ^"alpha"\n---\nnote about alpha\n--->'.length;
const ANN2_START = DOC.indexOf('<!--- n: ^"beta"');
const ANN2_END = ANN2_START + '<!--- n: ^"beta"\n---\nnote about beta\n--->'.length;

// Real parser output for this fixture: both block headers are compact-style
// (`n: ^"alpha"`), which the block grammar does not recognize, so scope falls
// back to the default Sentence(1) and the block is unstructured.
export const PARSED_ANNOTATIONS: Annotation[] = [
  {
    form: "block",
    annotation_type: "note",
    certainty: "neutral",
    scope: { kind: "sentence", value: 1 },
    body: "note about alpha",
    date: null,
    is_structured: false,
    char_start: ANN1_START,
    char_end: ANN1_END,
    original: DOC.slice(ANN1_START, ANN1_END),
  },
  {
    form: "block",
    annotation_type: "note",
    certainty: "neutral",
    scope: { kind: "sentence", value: 1 },
    body: "note about beta",
    date: null,
    is_structured: false,
    char_start: ANN2_START,
    char_end: ANN2_END,
    original: DOC.slice(ANN2_START, ANN2_END),
  },
];

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
