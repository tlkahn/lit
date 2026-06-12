import { useEffect, useRef, useState } from "react";
import { EditorView, keymap, type KeyBinding } from "@codemirror/view";
import { EditorState, EditorSelection, Compartment, Transaction, Annotation, type Extension } from "@codemirror/state";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import {
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { foldKeymap, type LanguageSupport } from "@codemirror/language";
import { createCodeExtensions } from "./codeExtensions";
import { getThemeExtension } from "./theme";
import { useModalLockStore } from "../stores/modalLock";

// Local annotation marking a programmatic doc replacement (decoupled from the
// markdown jumpHistory module, which we deliberately do not import here).
const docReplaced = Annotation.define<boolean>();

export interface UseCodeMirrorCodeProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  doc: string;
  language: LanguageSupport | null;
  onChange?: (content: string) => void;
  onSelectionChange?: (line: number, col: number) => void;
  keymapBindings?: KeyBinding[];
  onDocReplaced?: () => void;
  extraExtensions?: Extension[];
}

export function useCodeMirrorCode(props: UseCodeMirrorCodeProps): {
  view: EditorView | null;
} {
  const { containerRef, doc, language, onChange, onSelectionChange, keymapBindings, onDocReplaced, extraExtensions } = props;
  const [view, setView] = useState<EditorView | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const languageCompartment = useRef(new Compartment());
  const keymapCompartment = useRef(new Compartment());
  const editableCompartment = useRef(new Compartment());
  const suppressOnChange = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onDocReplacedRef = useRef(onDocReplaced);
  onDocReplacedRef.current = onDocReplaced;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isDark = document.documentElement.classList.contains("dark");
    const theme = isDark ? "dark" : "light";
    const { locked, llmLocked } = useModalLockStore.getState();

    const extensions = createCodeExtensions({
      theme,
      themeCompartment: themeCompartment.current,
      languageCompartment: languageCompartment.current,
      keymapCompartment: keymapCompartment.current,
      editableCompartment: editableCompartment.current,
      editorLocked: locked || llmLocked,
      language,
      keymapBindings,
      onChange: (content) => {
        if (!suppressOnChange.current) {
          onChangeRef.current?.(content);
        }
      },
      onSelectionChange: (line, col) => onSelectionChangeRef.current?.(line, col),
    });
    if (extraExtensions) extensions.push(...extraExtensions);

    const state = EditorState.create({ doc, extensions });
    const v = new EditorView({ state, parent: container });
    viewRef.current = v;
    setView(v);

    return () => {
      v.destroy();
      viewRef.current = null;
      setView(null);
    };
  }, [containerRef]);

  // Replace document content when the doc prop changes externally.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === doc) return;

    const savedHead = view.state.selection.main.head;
    suppressOnChange.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: doc },
      annotations: [docReplaced.of(true), Transaction.addToHistory.of(false)],
    });
    suppressOnChange.current = false;
    const clampedPos = Math.min(savedHead, view.state.doc.length);
    view.dispatch({ selection: EditorSelection.cursor(clampedPos) });
    onDocReplacedRef.current?.();
  }, [doc]);

  // Theme switching driven by the documentElement `dark` class.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains("dark");
      const theme = isDark ? "dark" : "light";
      view.dispatch({
        effects: themeCompartment.current.reconfigure(getThemeExtension(theme)),
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [view]);

  // Language compartment.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartment.current.reconfigure(language ?? []),
    });
  }, [language]);

  // Keymap compartment.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: keymapCompartment.current.reconfigure(
        keymap.of([
          ...(keymapBindings ?? []),
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
        ]),
      ),
    });
  }, [keymapBindings]);

  // Editable state driven by the modal-lock store.
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    let prev = useModalLockStore.getState().locked || useModalLockStore.getState().llmLocked;
    return useModalLockStore.subscribe((s) => {
      const shouldLock = s.locked || s.llmLocked;
      if (shouldLock === prev) return;
      prev = shouldLock;
      v.dispatch({
        effects: editableCompartment.current.reconfigure(
          EditorView.editable.of(!shouldLock),
        ),
      });
    });
  }, [view]);

  return { view };
}
