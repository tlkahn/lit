import { type Extension, Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  type KeyBinding,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  indentOnInput,
  foldGutter,
  foldKeymap,
  type LanguageSupport,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { search, searchKeymap } from "@codemirror/search";
import { getThemeExtension, highlightExtension, searchTheme } from "./theme";
import { pairWrapExtension } from "./pairWrap";

export interface CodeExtensionConfig {
  theme: "light" | "dark";
  themeCompartment: Compartment;
  languageCompartment: Compartment;
  keymapCompartment: Compartment;
  editableCompartment: Compartment;
  editorLocked?: boolean;
  language?: LanguageSupport | null;
  keymapBindings?: KeyBinding[];
  onChange?: (content: string) => void;
  onSelectionChange?: (line: number, col: number) => void;
}

/**
 * Minimal CM6 extension set for code files. No markdown(), no live preview, no
 * annotations, no wikilink/jump history, no line wrapping (code should not
 * soft-wrap). Syntax coloring comes from theme.ts's classHighlighter via
 * highlightExtension.
 */
export function createCodeExtensions(config: CodeExtensionConfig): Extension[] {
  return [
    pairWrapExtension(),
    config.languageCompartment.of(config.language ?? []),
    config.themeCompartment.of(getThemeExtension(config.theme)),
    highlightExtension,
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    bracketMatching(),
    indentOnInput(),
    foldGutter(),
    closeBrackets(),
    EditorState.allowMultipleSelections.of(true),
    history(),
    search(),
    searchTheme,
    config.editableCompartment.of(
      EditorView.editable.of(!(config.editorLocked ?? false)),
    ),
    // User bindings come first so custom shortcuts win over built-ins.
    config.keymapCompartment.of(
      keymap.of([
        ...(config.keymapBindings ?? []),
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
      ]),
    ),
    keymap.of(searchKeymap),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && config.onChange) {
        config.onChange(update.state.doc.toString());
      }
      if (
        update.view.hasFocus &&
        (update.selectionSet || update.focusChanged) &&
        config.onSelectionChange
      ) {
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos);
        config.onSelectionChange(line.number, pos - line.from + 1);
      }
    }),
  ];
}
