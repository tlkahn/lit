import { useEffect, useRef, useState } from "react";
import { EditorView, keymap, type KeyBinding as CM6KeyBinding } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { createExtensions } from "./extensions";
import { getThemeExtension } from "./theme";

export interface UseCodeMirrorProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  doc: string;
  onChange?: (content: string) => void;
  resolveImageSrc?: (src: string) => string;
  onDocReplaced?: () => void;
  keymapBindings?: CM6KeyBinding[];
}

export function useCodeMirror(props: UseCodeMirrorProps): {
  view: EditorView | null;
} {
  const { containerRef, doc, onChange, resolveImageSrc, onDocReplaced, keymapBindings } = props;
  const [view, setView] = useState<EditorView | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const keymapCompartment = useRef(new Compartment());
  const suppressOnChange = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const resolveImageSrcRef = useRef(resolveImageSrc);
  resolveImageSrcRef.current = resolveImageSrc;
  const onDocReplacedRef = useRef(onDocReplaced);
  onDocReplacedRef.current = onDocReplaced;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isDark = document.documentElement.classList.contains("dark");
    const theme = isDark ? "dark" : "light";

    const extensions = createExtensions({
      theme,
      themeCompartment: themeCompartment.current,
      keymapCompartment: keymapCompartment.current,
      keymapBindings,
      onChange: (content) => {
        if (!suppressOnChange.current) {
          onChangeRef.current?.(content);
        }
      },
      resolveImageSrc: (src) => resolveImageSrcRef.current?.(src) ?? src,
    });

    const state = EditorState.create({ doc, extensions });
    const v = new EditorView({ state, parent: container });
    viewRef.current = v;
    setView(v);
    console.debug("[useCodeMirror] editor mounted, doc length:", doc.length);

    return () => {
      console.debug("[useCodeMirror] editor destroyed");
      v.destroy();
      viewRef.current = null;
      setView(null);
    };
  }, [containerRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === doc) return;

    console.debug("[useCodeMirror] doc prop changed, replacing editor content. old:", current.length, "new:", doc.length);
    suppressOnChange.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: doc },
    });
    suppressOnChange.current = false;
    onDocReplacedRef.current?.();
  }, [doc]);

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

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: keymapCompartment.current.reconfigure(
        keymap.of([...(keymapBindings ?? []), ...defaultKeymap, ...historyKeymap]),
      ),
    });
  }, [keymapBindings]);

  return { view };
}
