import { useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { createExtensions } from "./extensions";
import { getThemeExtension } from "./theme";

export interface UseCodeMirrorProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  doc: string;
  onChange?: (content: string) => void;
  resolveImageSrc?: (src: string) => string;
}

export function useCodeMirror(props: UseCodeMirrorProps): {
  view: EditorView | null;
} {
  const { containerRef, doc, onChange, resolveImageSrc } = props;
  const [view, setView] = useState<EditorView | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const suppressOnChange = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const resolveImageSrcRef = useRef(resolveImageSrc);
  resolveImageSrcRef.current = resolveImageSrc;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isDark = document.documentElement.classList.contains("dark");
    const theme = isDark ? "dark" : "light";

    const extensions = createExtensions({
      theme,
      themeCompartment: themeCompartment.current,
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

  return { view };
}
