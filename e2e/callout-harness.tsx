import { EditorState, Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createExtensions } from "../src/editor/extensions";
import "../src/index.css";

const DOC = `# Test

> [!main]
> śrī devyuvāca ।

> [!quote]
> śrutaṃ deva'........ityādeḥ ।

> [!main]
> bhairava uvāca ।

tail text
`;

const view = new EditorView({
  state: EditorState.create({
    doc: DOC,
    extensions: createExtensions({
      theme: "light",
      themeCompartment: new Compartment(),
      keymapCompartment: new Compartment(),
      foldCompartment: new Compartment(),
      crossrefCompartment: new Compartment(),
      noteDirCompartment: new Compartment(),
      notePathCompartment: new Compartment(),
      mediaThumbnailsCompartment: new Compartment(),
      annotationCompartment: new Compartment(),
      annotationEnabled: false,
      focusModeCompartment: new Compartment(),
      editableCompartment: new Compartment(),
      openUrl: () => {},
    }),
  }),
  parent: document.getElementById("harness-root")!,
});

declare global {
  interface Window {
    __VIEW__: EditorView;
  }
}
window.__VIEW__ = view;
