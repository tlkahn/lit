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
    color: "var(--text-accent)",
    textDecoration: "underline",
    cursor: "pointer",
  },
  ".cm-preview-code-block": {
    backgroundColor: "var(--code-background)",
    borderRadius: "4px",
    padding: "2px 0",
  },
  ".cm-hidden-line": {
    fontSize: "0",
    lineHeight: "0",
    height: "0",
    overflow: "hidden",
  },

  ".cm-preview-wikilink": {
    color: "var(--color-purple, var(--text-accent))",
    textDecoration: "underline",
    cursor: "pointer",
  },

  // Callouts — base
  ".cm-callout": {
    borderLeft: "3px solid var(--text-faint)",
    borderRadius: "4px",
    padding: "0 8px",
    margin: "2px 0",
    backgroundColor: "color-mix(in srgb, var(--text-faint) 8%, transparent)",
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
    borderLeftColor: "var(--color-blue)",
    backgroundColor: "color-mix(in srgb, var(--color-blue) 8%, transparent)",
  },
  ".cm-callout-tip": {
    borderLeftColor: "var(--color-green)",
    backgroundColor: "color-mix(in srgb, var(--color-green) 8%, transparent)",
  },
  ".cm-callout-warning": {
    borderLeftColor: "var(--color-yellow)",
    backgroundColor: "color-mix(in srgb, var(--color-yellow) 8%, transparent)",
  },
  ".cm-callout-danger": {
    borderLeftColor: "var(--color-red)",
    backgroundColor: "color-mix(in srgb, var(--color-red) 8%, transparent)",
  },
  ".cm-callout-info": {
    borderLeftColor: "var(--color-blue)",
    backgroundColor: "color-mix(in srgb, var(--color-blue) 8%, transparent)",
  },
  ".cm-callout-success": {
    borderLeftColor: "var(--color-green)",
    backgroundColor: "color-mix(in srgb, var(--color-green) 8%, transparent)",
  },
  ".cm-callout-failure": {
    borderLeftColor: "var(--color-red)",
    backgroundColor: "color-mix(in srgb, var(--color-red) 8%, transparent)",
  },
  ".cm-callout-bug": {
    borderLeftColor: "var(--color-orange)",
    backgroundColor: "color-mix(in srgb, var(--color-orange) 8%, transparent)",
  },
  ".cm-callout-example": {
    borderLeftColor: "var(--color-purple)",
    backgroundColor: "color-mix(in srgb, var(--color-purple) 8%, transparent)",
  },
  ".cm-callout-quote": {
    borderLeftColor: "var(--text-faint)",
    backgroundColor: "color-mix(in srgb, var(--text-faint) 8%, transparent)",
  },
  ".cm-callout-question": {
    borderLeftColor: "var(--color-yellow)",
    backgroundColor: "color-mix(in srgb, var(--color-yellow) 8%, transparent)",
  },
  ".cm-callout-abstract": {
    borderLeftColor: "var(--color-cyan)",
    backgroundColor: "color-mix(in srgb, var(--color-cyan) 8%, transparent)",
  },
  ".cm-callout-todo": {
    borderLeftColor: "var(--color-blue)",
    backgroundColor: "color-mix(in srgb, var(--color-blue) 8%, transparent)",
  },

  // Math
  ".cm-preview-math-inline": {
    padding: "0 2px",
  },
  ".cm-preview-math-display": {
    textAlign: "center",
    padding: "8px 0",
  },
  ".cm-preview-math-error": {
    color: "var(--text-error)",
    fontStyle: "italic",
  },
  ".cm-preview-math-inline .katex, .cm-preview-math-display .katex": {
    fontSize: "1em",
  },

  // Override tags.quote gray/italic within callout body lines
  "& .cm-line.cm-callout span": {
    color: "inherit !important",
    fontStyle: "normal !important",
  },
  "& .cm-line.cm-callout .cm-preview-link": {
    color: "var(--text-accent) !important",
  },
  "& .cm-line.cm-callout .cm-preview-wikilink": {
    color: "var(--color-purple, var(--text-accent)) !important",
  },
  "& .cm-line.cm-callout .cm-preview-italic": {
    fontStyle: "italic !important",
  },
});
