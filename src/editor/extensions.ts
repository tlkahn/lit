import { type Extension, Compartment, Prec, EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { enterInList, indentListItem, outdentListItem } from "./listCommands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { GFM } from "@lezer/markdown";
import { getThemeExtension, highlightExtension, searchTheme } from "./theme";
import { search, searchKeymap } from "@codemirror/search";
import { livePreviewExtension, frontmatterFacet, noteDirFacet, mediaThumbnailsFacet } from "./livePreview";
import { foldExtension, type FoldConfig } from "./fold";
import { focusModeExtension } from "./focusMode";
import { annotationExtension } from "./livePreview/annotationState";
import { jumpHistoryExtension } from "./jumpHistory";
import { WikiLink } from "./markdown/wikilink";
import { Frontmatter, FrontmatterYamlWrap } from "./markdown/frontmatter";
import { Math } from "./markdown/math";
import { Comment } from "./markdown/comment";
import { Annotation } from "./markdown/annotation";

export interface ExtensionConfig {
  theme: "light" | "dark";
  themeCompartment: Compartment;
  keymapCompartment: Compartment;
  foldCompartment: Compartment;
  foldConfig?: FoldConfig;
  crossrefCompartment: Compartment;
  noteDirCompartment: Compartment;
  mediaThumbnailsCompartment: Compartment;
  annotationCompartment: Compartment;
  annotationEnabled?: boolean;
  focusModeCompartment: Compartment;
  focusModeActive?: boolean;
  editableCompartment: Compartment;
  editorLocked?: boolean;
  frontmatter?: Record<string, unknown>;
  noteDir?: string;
  mediaThumbnails?: boolean;
  keymapBindings?: import("@codemirror/view").KeyBinding[];
  onChange?: (content: string) => void;
  onSelectionChange?: (line: number, col: number) => void;
  openUrl?: (url: string) => void;
  openFilePath?: (path: string) => void;
  resolveImageSrc?: (src: string) => string;
  navigateToPage?: (target: string, section?: string, departurePos?: number) => void;
}

export function createExtensions(config: ExtensionConfig): Extension[] {
  return [
    markdown({
      extensions: [GFM, WikiLink, Frontmatter, FrontmatterYamlWrap, Math, Comment, Annotation],
      codeLanguages: languages,
    }),
    config.themeCompartment.of(getThemeExtension(config.theme)),
    highlightExtension,
    livePreviewExtension({ openUrl: config.openUrl, openFilePath: config.openFilePath, resolveImageSrc: config.resolveImageSrc, navigateToPage: config.navigateToPage }),
    config.crossrefCompartment.of(frontmatterFacet.of(config.frontmatter ?? {})),
    config.noteDirCompartment.of(noteDirFacet.of(config.noteDir ?? "")),
    config.mediaThumbnailsCompartment.of(mediaThumbnailsFacet.of(config.mediaThumbnails ?? true)),
    config.annotationCompartment.of(
      (config.annotationEnabled ?? true) ? annotationExtension() : [],
    ),
    config.foldCompartment.of(foldExtension(config.foldConfig)),
    config.focusModeCompartment.of(focusModeExtension(config.focusModeActive ?? false)),
    config.editableCompartment.of(EditorView.editable.of(!(config.editorLocked ?? false))),
    EditorState.allowMultipleSelections.of(true),
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
    jumpHistoryExtension(),
    drawSelection(),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && config.onChange) {
        config.onChange(update.state.doc.toString());
      }
      if (update.view.hasFocus && (update.selectionSet || update.focusChanged) && config.onSelectionChange) {
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos);
        config.onSelectionChange(line.number, pos - line.from + 1);
      }
    }),
  ];
}
