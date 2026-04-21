import { EditorView } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { classHighlighter, tagHighlighter, tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

const shared = EditorView.baseTheme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-content": {
    padding: "1rem 1.5rem",
    fontFamily: "var(--font-text-theme, var(--font-interface-theme, -apple-system, BlinkMacSystemFont, sans-serif))",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
  },
  ".cm-gutters": { display: "none" },
});

export const editorTheme: Extension = [
  shared,
  EditorView.theme({
    "&": {
      backgroundColor: "var(--background-primary)",
      color: "var(--text-normal)",
    },
    ".cm-cursor": { borderLeftColor: "var(--text-normal)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "var(--text-selection)",
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
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: "var(--text-selection)",
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
