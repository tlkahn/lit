import { EditorView } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { classHighlighter, tagHighlighter, tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";


/**
 * Shared base-theme spec for markdown and code editors.
 *
 * The spec is exported (mirroring `livePreviewThemeSpec`) so tests can lock the
 * width contract that makes CM wrap to the pane width: the editor root is
 * `width: 100%` with `minWidth: 0`, so descendants (`.cm-scroller` /
 * `.cm-content`) measure against the pane box rather than an inflated content
 * width that an outer `overflow-hidden` would otherwise clip.
 *
 * The root width contract (`&` = `width: 100%` / `minWidth: 0`) is shared by
 * markdown and code editors. The `.cm-content` max-width / clip rules below
 * are **markdown-oriented**: prose stays within the scroller (`maxWidth:
 * "100%"` + `overflowX: "clip"`, plus line wrapping). Code editors override
 * these content rules with `codeEditorContentThemeSpec` so long non-wrapping
 * lines can extend `.cm-content` past the scroller and `.cm-scroller` becomes
 * the horizontal scrollport.
 */
export const editorBaseThemeSpec: { [selector: string]: { [prop: string]: string | number } } = {
  "&": { height: "100%", width: "100%", minWidth: 0, containerType: "inline-size" },
  ".cm-scroller": { overflow: "auto", overscrollBehavior: "contain", scrollbarGutter: "stable" },
  ".cm-content": {
    minWidth: 0,
    maxWidth: "100%",
    overflowX: "clip",
    padding: "1rem 1.5rem",
    fontFamily: "var(--font-text-theme, var(--font-interface-theme, -apple-system, BlinkMacSystemFont, sans-serif))",
    fontSize: "var(--font-text-size, 16px)",
    lineHeight: "1.5",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
  },
};

/**
 * Code-editor-only override of the shared `.cm-content` rules. Code does not
 * soft-wrap, so long lines must be allowed to grow `.cm-content` past the
 * scroller width (`maxWidth: "none"`) and the scroller (`.cm-scroller`) owns
 * horizontal scrolling. Applied inside `createCodeExtensions` via
 * `EditorView.baseTheme` so it merges over the shared markdown-oriented clip.
 */
export const codeEditorContentThemeSpec: { [selector: string]: { [prop: string]: string | number } } = {
  ".cm-content": {
    maxWidth: "none",
    overflowX: "visible",
  },
};

const shared = EditorView.baseTheme(editorBaseThemeSpec);

export const editorTheme: Extension = [
  shared,
  EditorView.theme({
    "&": {
      backgroundColor: "var(--background-primary)",
      color: "var(--text-normal)",
    },
    ".cm-cursor": { borderLeftColor: "var(--text-normal)" },
    ".cm-content ::selection": {
      backgroundColor: "var(--text-selection) !important",
    },
    ".cm-content::selection": {
      backgroundColor: "var(--text-selection) !important",
    },
  }),
];

export const editorDarkTheme: Extension = [
  shared,
  EditorView.theme(
    {
      "&": {
        backgroundColor: "var(--background-primary)",
        color: "var(--text-normal)",
      },
      ".cm-cursor": { borderLeftColor: "var(--text-normal)" },
      ".cm-content ::selection": {
        backgroundColor: "var(--text-selection) !important",
      },
      ".cm-content::selection": {
        backgroundColor: "var(--text-selection) !important",
      },
    },
    { dark: true },
  ),
];

const markdownHighlighter = tagHighlighter([
  { tag: tags.heading1, class: "tok-heading1" },
  { tag: tags.heading2, class: "tok-heading2" },
  { tag: tags.heading3, class: "tok-heading3" },
  { tag: tags.heading4, class: "tok-heading4" },
  { tag: tags.heading5, class: "tok-heading5" },
  { tag: tags.heading6, class: "tok-heading6" },
  { tag: tags.monospace, class: "tok-monospace" },
  { tag: tags.quote, class: "tok-quote" },
  { tag: tags.list, class: "tok-list" },
]);

export const highlightExtension: Extension = [
  syntaxHighlighting(classHighlighter),
  syntaxHighlighting(markdownHighlighter),
];

export function getThemeExtension(theme: "light" | "dark"): Extension {
  return theme === "dark" ? editorDarkTheme : editorTheme;
}

export const searchTheme: Extension = EditorView.baseTheme({
  ".cm-panels": {
    backgroundColor: "var(--background-secondary)",
    color: "var(--text-normal)",
    borderBottom: "1px solid var(--background-modifier-border)",
  },
  ".cm-search": {
    padding: "4px 8px",
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    alignItems: "center",
  },
  ".cm-search input": {
    backgroundColor: "var(--background-primary)",
    color: "var(--text-normal)",
    border: "1px solid var(--background-modifier-border)",
    borderRadius: "4px",
    padding: "2px 6px",
    fontSize: "0.8125rem",
    outline: "none",
  },
  ".cm-search input:focus": {
    borderColor: "var(--interactive-accent)",
  },
  ".cm-search button": {
    backgroundColor: "var(--interactive-normal)",
    color: "var(--text-normal)",
    border: "1px solid var(--background-modifier-border)",
    borderRadius: "4px",
    padding: "2px 8px",
    fontSize: "0.8125rem",
    cursor: "pointer",
  },
  ".cm-search button:hover": {
    backgroundColor: "var(--interactive-hover)",
  },
  ".cm-search label": {
    fontSize: "0.8125rem",
    color: "var(--text-muted)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--text-highlight-bg, rgba(255, 208, 0, 0.4))",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "var(--text-selection)",
  },
});
