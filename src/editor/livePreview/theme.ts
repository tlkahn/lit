import { EditorView } from "@codemirror/view";

export const livePreviewBaseTheme = EditorView.baseTheme({
  ".cm-preview-h1": { fontSize: "1.5em", fontWeight: "bold" },
  ".cm-preview-h2": { fontSize: "1.3em", fontWeight: "bold" },
  ".cm-preview-h3": { fontSize: "1.15em", fontWeight: "bold" },
  ".cm-preview-h4": { fontSize: "1.05em", fontWeight: "bold" },
  ".cm-preview-h5": { fontWeight: "bold" },
  ".cm-preview-h6": { fontWeight: "bold" },
  ".cm-preview-bold": { fontWeight: "bold" },
  ".cm-preview-italic": { fontStyle: "italic" },
  ".cm-preview-link": {
    color: "#60a5fa",
    textDecoration: "underline",
    cursor: "pointer",
  },
  ".cm-preview-code-block": {
    backgroundColor: "rgba(128, 128, 128, 0.1)",
    borderRadius: "4px",
    padding: "2px 0",
  },
});
