import { type Extension, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { syntaxHighlighting } from "@codemirror/language";
import {
  lightTheme,
  darkTheme,
  lightHighlightStyle,
  darkHighlightStyle,
} from "./theme";

export interface ExtensionConfig {
  theme: "light" | "dark";
  themeCompartment: Compartment;
  highlightCompartment: Compartment;
  onChange?: (content: string) => void;
}

export function createExtensions(config: ExtensionConfig): Extension[] {
  const themeExt =
    config.theme === "light" ? lightTheme : darkTheme;
  const hlStyle =
    config.theme === "light" ? lightHighlightStyle : darkHighlightStyle;

  return [
    markdown({ extensions: GFM }),
    config.themeCompartment.of(themeExt),
    config.highlightCompartment.of(syntaxHighlighting(hlStyle)),
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
