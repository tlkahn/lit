import { useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { syntaxHighlighting } from "@codemirror/language";
import { createExtensions } from "./extensions";
import {
  lightTheme,
  darkTheme,
  lightHighlightStyle,
  darkHighlightStyle,
} from "./theme";

export interface UseCodeMirrorProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  doc: string;
  theme: "light" | "dark";
  onChange?: (content: string) => void;
  resolveImageSrc?: (src: string) => string;
}

export function useCodeMirror(props: UseCodeMirrorProps): {
  view: EditorView | null;
} {
  const { containerRef, doc, theme, onChange, resolveImageSrc } = props;
  const [view, setView] = useState<EditorView | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const highlightCompartment = useRef(new Compartment());
  const suppressOnChange = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const resolveImageSrcRef = useRef(resolveImageSrc);
  resolveImageSrcRef.current = resolveImageSrc;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const extensions = createExtensions({
      theme,
      themeCompartment: themeCompartment.current,
      highlightCompartment: highlightCompartment.current,
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

    return () => {
      v.destroy();
      viewRef.current = null;
      setView(null);
    };
  }, [containerRef]); // mount/unmount only — doc & theme synced in separate effects

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === doc) return;

    suppressOnChange.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: doc },
    });
    suppressOnChange.current = false;
  }, [doc]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const themeExt = theme === "light" ? lightTheme : darkTheme;
    const hlStyle =
      theme === "light" ? lightHighlightStyle : darkHighlightStyle;

    view.dispatch({
      effects: [
        themeCompartment.current.reconfigure(themeExt),
        highlightCompartment.current.reconfigure(
          syntaxHighlighting(hlStyle),
        ),
      ],
    });
  }, [theme]);

  return { view };
}
