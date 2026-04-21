import { type Extension, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { GFM } from "@lezer/markdown";
import { syntaxHighlighting } from "@codemirror/language";
import {
  lightTheme,
  darkTheme,
  lightHighlightStyle,
  darkHighlightStyle,
} from "./theme";
import { livePreviewExtension } from "./livePreview";
import { WikiLink } from "./markdown/wikilink";
import { Frontmatter } from "./markdown/frontmatter";
import { Math } from "./markdown/math";

export interface ExtensionConfig {
  theme: "light" | "dark";
  themeCompartment: Compartment;
  highlightCompartment: Compartment;
  onChange?: (content: string) => void;
  openUrl?: (url: string) => void;
  resolveImageSrc?: (src: string) => string;
}

export function createExtensions(config: ExtensionConfig): Extension[] {
  const themeExt =
    config.theme === "light" ? lightTheme : darkTheme;
  const hlStyle =
    config.theme === "light" ? lightHighlightStyle : darkHighlightStyle;

  return [
    markdown({
      extensions: [GFM, WikiLink, Frontmatter, Math],
      codeLanguages: languages,
    }),
    config.themeCompartment.of(themeExt),
    config.highlightCompartment.of(syntaxHighlighting(hlStyle)),
    livePreviewExtension({ openUrl: config.openUrl, resolveImageSrc: config.resolveImageSrc }),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && config.onChange) {
        config.onChange(update.state.doc.toString());
      }
    }),
  ];
}
