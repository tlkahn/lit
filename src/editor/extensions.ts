import { type Extension, Compartment, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { enterInList, indentListItem, outdentListItem } from "./listCommands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { GFM } from "@lezer/markdown";
import { getThemeExtension, highlightExtension, searchTheme } from "./theme";
import { search, searchKeymap } from "@codemirror/search";
import { livePreviewExtension } from "./livePreview";
import { foldExtension, type FoldConfig } from "./fold";
import { WikiLink } from "./markdown/wikilink";
import { Frontmatter, FrontmatterYamlWrap } from "./markdown/frontmatter";
import { Math } from "./markdown/math";
import { Comment } from "./markdown/comment";

export interface ExtensionConfig {
  theme: "light" | "dark";
  themeCompartment: Compartment;
  keymapCompartment: Compartment;
  foldCompartment: Compartment;
  foldConfig?: FoldConfig;
  keymapBindings?: import("@codemirror/view").KeyBinding[];
  onChange?: (content: string) => void;
  openUrl?: (url: string) => void;
  resolveImageSrc?: (src: string) => string;
}

export function createExtensions(config: ExtensionConfig): Extension[] {
  return [
    markdown({
      extensions: [GFM, WikiLink, Frontmatter, FrontmatterYamlWrap, Math, Comment],
      codeLanguages: languages,
    }),
    config.themeCompartment.of(getThemeExtension(config.theme)),
    highlightExtension,
    livePreviewExtension({ openUrl: config.openUrl, resolveImageSrc: config.resolveImageSrc }),
    config.foldCompartment.of(foldExtension(config.foldConfig)),
    history(),
    search(),
    keymap.of(searchKeymap),
    searchTheme,
    Prec.highest(keymap.of([
      { key: "Enter", run: enterInList },
      { key: "Tab", run: indentListItem },
      { key: "Shift-Tab", run: outdentListItem },
    ])),
    config.keymapCompartment.of(
      keymap.of([...(config.keymapBindings ?? []), ...defaultKeymap, ...historyKeymap]),
    ),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && config.onChange) {
        config.onChange(update.state.doc.toString());
      }
    }),
  ];
}
