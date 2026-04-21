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
  ".cm-hidden-line": {
    fontSize: "0",
    lineHeight: "0",
    height: "0",
    overflow: "hidden",
  },

  // Wikilinks
  ".cm-preview-wikilink": {
    color: "#a78bfa",
    textDecoration: "underline",
    cursor: "pointer",
  },

  // Callouts — base
  ".cm-callout": {
    borderLeft: "3px solid #6b7280",
    borderRadius: "4px",
    padding: "0 8px",
    margin: "2px 0",
    backgroundColor: "rgba(128, 128, 128, 0.05)",
  },
  ".cm-callout-header": {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontWeight: "bold",
    padding: "4px 0",
  },
  ".cm-callout-fold-icon": {
    cursor: "pointer",
    userSelect: "none",
    opacity: "0.7",
  },
  ".cm-callout-icon": {
    fontSize: "1.1em",
  },
  ".cm-callout-title": {
    flex: "1",
  },

  // Callouts — per-type
  ".cm-callout-note": {
    borderLeftColor: "#60a5fa",
    backgroundColor: "rgba(96, 165, 250, 0.08)",
  },
  ".cm-callout-tip": {
    borderLeftColor: "#34d399",
    backgroundColor: "rgba(52, 211, 153, 0.08)",
  },
  ".cm-callout-warning": {
    borderLeftColor: "#fbbf24",
    backgroundColor: "rgba(251, 191, 36, 0.08)",
  },
  ".cm-callout-danger": {
    borderLeftColor: "#f87171",
    backgroundColor: "rgba(248, 113, 113, 0.08)",
  },
  ".cm-callout-info": {
    borderLeftColor: "#60a5fa",
    backgroundColor: "rgba(96, 165, 250, 0.08)",
  },
  ".cm-callout-success": {
    borderLeftColor: "#34d399",
    backgroundColor: "rgba(52, 211, 153, 0.08)",
  },
  ".cm-callout-failure": {
    borderLeftColor: "#f87171",
    backgroundColor: "rgba(248, 113, 113, 0.08)",
  },
  ".cm-callout-bug": {
    borderLeftColor: "#fb923c",
    backgroundColor: "rgba(251, 146, 60, 0.08)",
  },
  ".cm-callout-example": {
    borderLeftColor: "#a78bfa",
    backgroundColor: "rgba(167, 139, 250, 0.08)",
  },
  ".cm-callout-quote": {
    borderLeftColor: "#9ca3af",
    backgroundColor: "rgba(156, 163, 175, 0.08)",
  },
  ".cm-callout-question": {
    borderLeftColor: "#fbbf24",
    backgroundColor: "rgba(251, 191, 36, 0.08)",
  },
  ".cm-callout-abstract": {
    borderLeftColor: "#38bdf8",
    backgroundColor: "rgba(56, 189, 248, 0.08)",
  },
  ".cm-callout-todo": {
    borderLeftColor: "#60a5fa",
    backgroundColor: "rgba(96, 165, 250, 0.08)",
  },

  // Dark mode callout overrides
  "&dark .cm-callout": {
    backgroundColor: "rgba(128, 128, 128, 0.1)",
  },
  "&dark .cm-callout-note": { backgroundColor: "rgba(96, 165, 250, 0.12)" },
  "&dark .cm-callout-tip": { backgroundColor: "rgba(52, 211, 153, 0.12)" },
  "&dark .cm-callout-warning": { backgroundColor: "rgba(251, 191, 36, 0.12)" },
  "&dark .cm-callout-danger": { backgroundColor: "rgba(248, 113, 113, 0.12)" },
  "&dark .cm-callout-info": { backgroundColor: "rgba(96, 165, 250, 0.12)" },
  "&dark .cm-callout-success": { backgroundColor: "rgba(52, 211, 153, 0.12)" },
  "&dark .cm-callout-failure": { backgroundColor: "rgba(248, 113, 113, 0.12)" },
  "&dark .cm-callout-bug": { backgroundColor: "rgba(251, 146, 60, 0.12)" },
  "&dark .cm-callout-example": { backgroundColor: "rgba(167, 139, 250, 0.12)" },
  "&dark .cm-callout-quote": { backgroundColor: "rgba(156, 163, 175, 0.12)" },
  "&dark .cm-callout-question": { backgroundColor: "rgba(251, 191, 36, 0.12)" },
  "&dark .cm-callout-abstract": { backgroundColor: "rgba(56, 189, 248, 0.12)" },
  "&dark .cm-callout-todo": { backgroundColor: "rgba(96, 165, 250, 0.12)" },

  // Math
  ".cm-preview-math-inline": {
    padding: "0 2px",
  },
  ".cm-preview-math-display": {
    textAlign: "center",
    padding: "8px 0",
  },
  ".cm-preview-math-error": {
    color: "#f87171",
    fontStyle: "italic",
  },
});
