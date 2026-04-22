import { type Extension, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { GFM } from "@lezer/markdown";
import { getThemeExtension, highlightExtension } from "./theme";
import { livePreviewExtension } from "./livePreview";
import { WikiLink } from "./markdown/wikilink";
import { Frontmatter, FrontmatterYamlWrap } from "./markdown/frontmatter";
import { Math } from "./markdown/math";

export interface ExtensionConfig {
  theme: "light" | "dark";
  themeCompartment: Compartment;
  onChange?: (content: string) => void;
  openUrl?: (url: string) => void;
  resolveImageSrc?: (src: string) => string;
}

export function createExtensions(config: ExtensionConfig): Extension[] {
  return [
    markdown({
      extensions: [GFM, WikiLink, Frontmatter, FrontmatterYamlWrap, Math],
      codeLanguages: languages,
    }),
    config.themeCompartment.of(getThemeExtension(config.theme)),
    highlightExtension,
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
