import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

const shared = EditorView.baseTheme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-content": {
    padding: "1rem 1.5rem",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
  },
  ".cm-gutters": { display: "none" },
});

export const lightTheme: Extension = [
  shared,
  EditorView.theme(
    {
      "&": { backgroundColor: "#ffffff", color: "#262626" },
      ".cm-cursor": { borderLeftColor: "#262626" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: "#dbeafe",
      },
    },
    { dark: false },
  ),
];

export const darkTheme: Extension = [
  shared,
  EditorView.theme(
    {
      "&": { backgroundColor: "#262626", color: "#e5e5e5" },
      ".cm-cursor": { borderLeftColor: "#e5e5e5" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: "#1e3a8a",
      },
    },
    { dark: true },
  ),
];

export const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: "bold", fontSize: "1.5em" },
  { tag: tags.heading2, fontWeight: "bold", fontSize: "1.3em" },
  { tag: tags.heading3, fontWeight: "bold", fontSize: "1.15em" },
  { tag: tags.heading4, fontWeight: "bold", fontSize: "1.05em" },
  { tag: tags.heading5, fontWeight: "bold" },
  { tag: tags.heading6, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.link, color: "#60a5fa", textDecoration: "underline" },
  { tag: tags.url, color: "#60a5fa" },
  { tag: tags.monospace, backgroundColor: "#f5f5f5", borderRadius: "3px" },
  { tag: tags.meta, color: "#a3a3a3" },
  { tag: tags.quote, color: "#737373", fontStyle: "italic" },
  { tag: tags.list, color: "#737373" },
]);

export const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: "bold", fontSize: "1.5em" },
  { tag: tags.heading2, fontWeight: "bold", fontSize: "1.3em" },
  { tag: tags.heading3, fontWeight: "bold", fontSize: "1.15em" },
  { tag: tags.heading4, fontWeight: "bold", fontSize: "1.05em" },
  { tag: tags.heading5, fontWeight: "bold" },
  { tag: tags.heading6, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.link, color: "#60a5fa", textDecoration: "underline" },
  { tag: tags.url, color: "#60a5fa" },
  { tag: tags.monospace, backgroundColor: "#404040", borderRadius: "3px" },
  { tag: tags.meta, color: "#a3a3a3" },
  { tag: tags.quote, color: "#737373", fontStyle: "italic" },
  { tag: tags.list, color: "#737373" },
]);

export function getThemeExtension(theme: "light" | "dark"): Extension {
  return theme === "light" ? lightTheme : darkTheme;
}

export function getHighlightExtension(theme: "light" | "dark"): Extension {
  return syntaxHighlighting(
    theme === "light" ? lightHighlightStyle : darkHighlightStyle,
  );
}
