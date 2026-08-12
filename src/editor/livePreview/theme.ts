import { EditorView } from "@codemirror/view";

export const livePreviewThemeSpec: Record<string, Record<string, string | Record<string, string>>> = {
  ".cm-preview-h1": { fontWeight: "bold", fontSize: "1.5em" },
  ".cm-preview-h2": { fontWeight: "bold", fontSize: "1.3em" },
  ".cm-preview-h3": { fontWeight: "bold", fontSize: "1.15em" },
  ".cm-preview-h4": { fontWeight: "bold", fontSize: "1.05em" },
  ".cm-preview-h5": { fontWeight: "bold" },
  ".cm-preview-h6": { fontWeight: "bold" },
  // The syntax highlighter's .tok-heading* spans nest inside the
  // .cm-preview-h* mark; both set em font-sizes, which multiply through
  // nesting. Neutralize the inner one so text and widgets share one scale.
  ".cm-preview-h1 .tok-heading1": { fontSize: "1em" },
  ".cm-preview-h2 .tok-heading2": { fontSize: "1em" },
  ".cm-preview-h3 .tok-heading3": { fontSize: "1em" },
  ".cm-preview-h4 .tok-heading4": { fontSize: "1em" },
  ".cm-preview-bold": { fontWeight: "bold" },
  ".cm-preview-italic": { fontStyle: "italic" },
  ".cm-preview-link": {
    color: "var(--text-accent)",
    textDecoration: "underline",
    cursor: "pointer",
  },
  ".cm-preview-code-inline": {
    fontFamily: "var(--font-monospace-theme, ui-monospace, SFMono-Regular, Menlo, Consolas, \"Noto Sans Mono\", monospace)",
    backgroundColor: "var(--code-background-translucent, var(--code-background))",
    padding: "2px 4px",
    borderRadius: "3px",
  },
  ".cm-preview-code-block": {
    backgroundColor: "var(--code-background-translucent, var(--code-background))",
    fontFamily: "var(--font-monospace-theme, ui-monospace, SFMono-Regular, Menlo, Consolas, \"Noto Sans Mono\", monospace)",
  },
  ".cm-code-fence-top": {
    backgroundColor: "var(--code-background-translucent, var(--code-background))",
    borderRadius: "4px 4px 0 0",
  },
  ".cm-code-fence-bottom": {
    backgroundColor: "var(--code-background-translucent, var(--code-background))",
    borderRadius: "0 0 4px 4px",
  },
  ".cm-preview-strikethrough": {
    textDecoration: "line-through",
  },

  // Escaped dollar stand-in (cm-preview-escaped-dollar). Glyph is the
  // differentiator; keep styling neutral. No margin, no fontSize change
  // (avoids caret/layout jump on reveal).
  ".cm-preview-escaped-dollar": {
    color: "inherit",
  },

  ".cm-preview-wikilink": {
    color: "var(--color-purple, var(--text-accent))",
    textDecoration: "underline",
    cursor: "pointer",
  },

  // List item hanging indent
  ".cm-list-item": {
    paddingLeft: "var(--li-indent, 0px)",
    textIndent: "calc(-1 * var(--li-indent, 0px))",
  },
  ".cm-blockquote.cm-list-item": {
    paddingLeft: "calc(8px + var(--li-indent, 0px))",
  },
  ".cm-callout.cm-list-item": {
    paddingLeft: "calc(12px + var(--li-indent, 0px))",
  },
  ".cm-list-item-continuation": {
    paddingLeft: "var(--li-indent, 0px)",
  },
  ".cm-blockquote.cm-list-item-continuation": {
    paddingLeft: "calc(8px + var(--li-indent, 0px))",
  },
  ".cm-callout.cm-list-item-continuation": {
    paddingLeft: "calc(12px + var(--li-indent, 0px))",
  },

  // Blockquotes
  ".cm-blockquote": {
    borderInlineStart: "3px solid var(--text-faint)",
    padding: "2px 8px",
  },
  "& .cm-line.cm-blockquote span": {
    color: "inherit !important",
    fontStyle: "normal !important",
  },
  "& .cm-line.cm-blockquote .cm-preview-link": {
    color: "var(--text-accent) !important",
  },
  "& .cm-line.cm-blockquote .cm-preview-wikilink": {
    color: "var(--color-purple, var(--text-accent)) !important",
  },
  "& .cm-line.cm-blockquote .cm-preview-italic": {
    fontStyle: "italic !important",
  },

  // Callouts — base. Mirrors .cm-annotation-callout (annotation.css): 4px soft
  // border, 5% background, 8px/12px block padding. The block padding is spread
  // across per-line decorations: inline padding on every line, top on
  // .cm-callout-first, bottom on .cm-callout-last (padding, never margin — CM6
  // height map). Corner radii live on the edge lines so the multi-line block
  // reads as one continuous box instead of per-line scallops.
  ".cm-callout": {
    borderInlineStart: "4px solid color-mix(in srgb, var(--text-faint) 60%, transparent)",
    padding: "0 12px",
    backgroundColor: "color-mix(in srgb, var(--text-faint) 5%, transparent)",
  },
  ".cm-callout-first": {
    borderStartStartRadius: "4px",
    borderStartEndRadius: "4px",
    paddingTop: "8px",
    paddingBottom: "6px",
  },
  ".cm-callout-last": {
    borderEndStartRadius: "4px",
    borderEndEndRadius: "4px",
    paddingBottom: "8px",
  },
  // inline-flex, not flex: a block-level widget splits the line's inline
  // content into separate line boxes, so CM6's widget buffers (the IMG
  // elements inserted around every inline widget) each claim a full
  // line-height of phantom vertical space. Keeping the header inline lets the
  // buffers share its line box.
  ".cm-callout-header": {
    display: "inline-flex",
    width: "100%",
    verticalAlign: "top",
    alignItems: "center",
    gap: "6px",
    fontWeight: "600",
    fontSize: "0.9em",
    padding: "0",
  },
  ".cm-callout-fold-icon": {
    cursor: "pointer",
    userSelect: "none",
    opacity: "0.7",
    display: "flex",
    alignItems: "center",
  },
  ".cm-callout-fold-icon .svg-icon": {
    width: "16px",
    height: "16px",
    strokeWidth: "2",
    transition: "transform 100ms ease-in-out",
  },
  ".cm-callout-fold-icon.is-collapsed .svg-icon": {
    transform: "rotate(-90deg)",
  },
  ".cm-callout-icon": {
    fontSize: "1em",
  },
  ".cm-callout-title": {
    flex: "1",
  },

  // Callouts — per-type
  ".cm-callout-note": {
    borderInlineStartColor: "color-mix(in srgb, var(--color-blue) 60%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--color-blue) 5%, transparent)",
  },
  ".cm-callout-tip": {
    borderInlineStartColor: "color-mix(in srgb, var(--color-green) 60%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--color-green) 5%, transparent)",
  },
  ".cm-callout-warning": {
    borderInlineStartColor: "color-mix(in srgb, var(--color-yellow) 60%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--color-yellow) 5%, transparent)",
  },
  ".cm-callout-danger": {
    borderInlineStartColor: "color-mix(in srgb, var(--color-red) 60%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--color-red) 5%, transparent)",
  },
  ".cm-callout-info": {
    borderInlineStartColor: "color-mix(in srgb, var(--color-blue) 60%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--color-blue) 5%, transparent)",
  },
  ".cm-callout-success": {
    borderInlineStartColor: "color-mix(in srgb, var(--color-green) 60%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--color-green) 5%, transparent)",
  },
  ".cm-callout-failure": {
    borderInlineStartColor: "color-mix(in srgb, var(--color-red) 60%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--color-red) 5%, transparent)",
  },
  ".cm-callout-bug": {
    borderInlineStartColor: "color-mix(in srgb, var(--color-orange) 60%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--color-orange) 5%, transparent)",
  },
  ".cm-callout-example": {
    borderInlineStartColor: "color-mix(in srgb, var(--color-purple) 60%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--color-purple) 5%, transparent)",
  },
  ".cm-callout-quote": {
    borderInlineStartColor: "color-mix(in srgb, var(--text-faint) 60%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--text-faint) 5%, transparent)",
  },
  ".cm-callout-question": {
    borderInlineStartColor: "color-mix(in srgb, var(--color-yellow) 60%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--color-yellow) 5%, transparent)",
  },
  ".cm-callout-abstract": {
    borderInlineStartColor: "color-mix(in srgb, var(--color-cyan) 60%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--color-cyan) 5%, transparent)",
  },
  ".cm-callout-todo": {
    borderInlineStartColor: "color-mix(in srgb, var(--color-blue) 60%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--color-blue) 5%, transparent)",
  },

  // Math
  ".cm-preview-math-inline": {
    padding: "0 2px",
    display: "inline-block",
    maxWidth: "50cqi",
    overflow: "hidden",
    whiteSpace: "nowrap",
    verticalAlign: "bottom",
  },
  ".cm-preview-math-display": {
    textAlign: "center",
    padding: "4px 0",
    contain: "inline-size",
    overflowX: "auto",
  },
  ".cm-preview-math-display .katex-display": {
    margin: "0.2em 0",
  },
  ".cm-preview-math-error": {
    color: "var(--text-error)",
    fontStyle: "italic",
  },
  ".cm-preview-math-inline .katex, .cm-preview-math-display .katex": {
    fontSize: "1em",
  },

  // Comments
  ".tok-comment": {
    color: "var(--text-faint)",
    opacity: "0.6",
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

  // Tables
  ".cm-preview-table-container": {
    overflowX: "auto",
    margin: "4px 0",
  },
  ".cm-preview-table": {
    borderCollapse: "collapse",
    width: "100%",
    fontSize: "inherit",
  },
  ".cm-preview-table th": {
    fontWeight: "bold",
    backgroundColor: "var(--background-secondary, rgba(0,0,0,0.03))",
    padding: "4px 8px",
    border: "1px solid var(--background-modifier-border, #e0e0e0)",
  },
  ".cm-preview-table td": {
    padding: "4px 8px",
    border: "1px solid var(--background-modifier-border, #e0e0e0)",
  },
  ".cm-preview-table tr:hover": {
    backgroundColor: "var(--background-secondary, rgba(0,0,0,0.02))",
  },
  ".cm-preview-table [contenteditable]": {
    outline: "none",
    cursor: "text",
    minWidth: "40px",
  },
  ".cm-preview-table [contenteditable]:focus": {
    outline: "2px solid var(--text-selection, rgba(59, 130, 246, 0.3))",
    outlineOffset: "-2px",
  },

  // Image thumbnails
  ".cm-preview-image-thumbnail": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    maxHeight: "120px",
    overflow: "hidden",
    cursor: "zoom-in",
    padding: "4px 0",
  },
  ".cm-preview-image-thumbnail img": {
    maxHeight: "112px",
    maxWidth: "100%",
    objectFit: "contain",
  },

  // Broken image indicator
  ".cm-preview-image-error": {
    minWidth: "24px",
    minHeight: "24px",
    display: "inline-block",
    opacity: "0.5",
  },

  // Mermaid thumbnails
  ".cm-preview-mermaid--thumbnail": {
    maxHeight: "120px",
    overflow: "hidden",
    cursor: "zoom-in",
  },
  ".cm-preview-mermaid--thumbnail svg": {
    maxHeight: "112px",
  },

  // Mermaid diagrams
  ".cm-preview-mermaid": {
    textAlign: "center",
    padding: "8px 12px",
    backgroundColor: "var(--background-primary-alt)",
    borderRadius: "6px",
    border: "1px solid var(--background-modifier-border)",
  },
  ".cm-preview-mermaid svg": {
    maxWidth: "100%",
  },
  ".cm-preview-mermaid-loading": {
    display: "flex",
    justifyContent: "center",
    padding: "16px 0",
    color: "var(--text-faint)",
  },
  ".cm-preview-mermaid-loading svg": {
    width: "24px",
    height: "24px",
  },
  // Crossref citations and definitions
  ".cm-crossref-citation": {
    color: "var(--crossref-citation-color, var(--text-accent))",
    cursor: "pointer",
  },
  ".cm-crossref-citation:hover": {
    textDecoration: "underline",
  },
  ".cm-crossref-citation.invalid": {
    color: "var(--crossref-invalid-color, var(--text-error, #e53e3e))",
    textDecoration: "underline wavy",
  },
  ".cm-crossref-definition": {
    color: "var(--crossref-definition-color, var(--text-faint))",
  },
  "@keyframes cm-crossref-blink": {
    "0%": { backgroundColor: "color-mix(in srgb, var(--crossref-highlight-color, var(--text-accent)) 30%, transparent)" },
    "100%": { backgroundColor: "transparent" },
  },
  ".cm-crossref-highlight-blink": {
    animation: "cm-crossref-blink 1.5s ease-out",
  },
  ".cm-crossref-citeproc": {
    color: "var(--crossref-citeproc-color, var(--color-purple, var(--text-accent)))",
  },
  ".cm-crossref-citeproc-key": {
    cursor: "pointer",
  },
  ".cm-crossref-citeproc-key:hover": {
    textDecoration: "underline",
  },
  ".cm-crossref-citeproc-key.invalid": {
    color: "var(--crossref-invalid-color, var(--text-error, #e53e3e))",
    textDecoration: "underline wavy",
    cursor: "default",
  },
  // Horizontal rules
  ".cm-preview-hr": {
    border: "none",
    padding: "0",
    height: "1lh",
    boxSizing: "border-box",
    backgroundImage: "linear-gradient(to right, var(--text-faint), var(--text-faint))",
    backgroundSize: "100% 1px",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  ".cm-preview-hr.cm-preview-hr-short": {
    height: "2lh",
    backgroundSize: "25% 1px",
    opacity: "0.6",
  },

  // Page break dividers
  ".cm-preview-page-break": {
    display: "flex",
    alignItems: "center",
    height: "1lh",
    boxSizing: "border-box",
    gap: "8px",
  },
  ".cm-preview-page-break-rule": {
    flex: "1",
    height: "0",
    borderTop: "1px solid var(--text-faint)",
  },
  ".cm-preview-page-break-label": {
    fontSize: "12px",
    fontWeight: "400",
    color: "var(--text-faint)",
    whiteSpace: "nowrap",
    lineHeight: "1",
  },

  // Footnotes
  ".cm-footnote-ref": {
    color: "var(--text-accent)",
    cursor: "pointer",
    fontSize: "0.75em",
    verticalAlign: "super",
  },
  ".cm-footnote-ref:hover": {
    textDecoration: "underline",
  },
  // Footnote definitions (live preview, caret outside). Padding only, never
  // margin (CM6 height map). No whole-line color: the body must stay readable
  // as normal text, not muted or link-styled.
  ".cm-footnote-def": {
    borderInlineStart: "2px solid var(--text-faint)",
    paddingLeft: "8px",
  },
  ".cm-footnote-def-mark": {
    color: "var(--text-accent)",
    fontWeight: "600",
    paddingRight: "0.35em",
  },
  // Rendered def body (caret outside). Padding only, never margin (CM6
  // height map). Paragraphs and headings use padding separation too so the
  // widget's estimatedHeight stays honest.
  ".cm-footnote-def-body": {
    paddingTop: "0.15em",
    paddingBottom: "0.15em",
    display: "block",
  },
  ".cm-footnote-def-body p": {
    margin: "0",
  },
  ".cm-footnote-def-body p + p": {
    paddingTop: "0.5em",
  },
  ".cm-footnote-def-body h1, .cm-footnote-def-body h2, .cm-footnote-def-body h3, .cm-footnote-def-body h4, .cm-footnote-def-body h5, .cm-footnote-def-body h6": {
    fontWeight: "600",
    paddingTop: "0.35em",
    paddingBottom: "0.15em",
  },
  ".cm-footnote-tooltip": {
    backgroundColor: "var(--background-primary, #fff)",
    border: "1px solid var(--background-modifier-border, #e0e0e0)",
    borderRadius: "6px",
    padding: "8px 12px",
    maxWidth: "400px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    fontSize: "0.9em",
  },
  ".cm-footnote-tooltip p": {
    margin: "0",
  },

  ".cm-citeproc-tooltip": {
    backgroundColor: "var(--background-primary, #fff)",
    border: "1px solid var(--background-modifier-border, #e0e0e0)",
    borderRadius: "6px",
    padding: "6px 10px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    fontSize: "0.9em",
  },
  ".cm-citeproc-tooltip-action": {
    background: "none",
    border: "none",
    color: "var(--text-accent)",
    cursor: "pointer",
    padding: "2px 4px",
    borderRadius: "4px",
    fontSize: "inherit",
    fontFamily: "inherit",
  },
  ".cm-citeproc-tooltip-action:hover": {
    backgroundColor: "var(--background-modifier-hover, rgba(0,0,0,0.05))",
  },
  ".cm-citeproc-tooltip-action:disabled": {
    color: "var(--text-faint)",
    cursor: "default",
  },

  ".cm-preview-mermaid-error": {
    color: "var(--text-error, #e53e3e)",
    fontStyle: "italic",
    padding: "8px",
    backgroundColor: "color-mix(in srgb, var(--text-error, #e53e3e) 8%, transparent)",
    borderRadius: "4px",
    fontFamily: "monospace",
    fontSize: "0.85em",
    whiteSpace: "pre-wrap",
    textAlign: "start",
  },
};

export const livePreviewBaseTheme = EditorView.baseTheme(livePreviewThemeSpec);
