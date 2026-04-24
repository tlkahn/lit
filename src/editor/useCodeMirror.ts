import { useEffect, useRef, useState } from "react";
import { EditorView, keymap, type KeyBinding as CM6KeyBinding } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { createExtensions } from "./extensions";
import { getThemeExtension } from "./theme";
import { foldExtension } from "./fold";
import { frontmatterFacet, noteDirFacet } from "./livePreview";
import { docReplaced } from "./jumpHistory";
import { usePreferencesStore } from "../stores/preferences";

export interface UseCodeMirrorProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  doc: string;
  onChange?: (content: string) => void;
  resolveImageSrc?: (src: string) => string;
  onDocReplaced?: () => void;
  onReady?: (view: EditorView) => void;
  keymapBindings?: CM6KeyBinding[];
  frontmatter?: Record<string, unknown>;
  noteDir?: string;
}

export function useCodeMirror(props: UseCodeMirrorProps): {
  view: EditorView | null;
} {
  const { containerRef, doc, onChange, resolveImageSrc, onDocReplaced, onReady, keymapBindings, frontmatter, noteDir } = props;
  const [view, setView] = useState<EditorView | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const keymapCompartment = useRef(new Compartment());
  const foldCompartment = useRef(new Compartment());
  const crossrefCompartment = useRef(new Compartment());
  const noteDirCompartment = useRef(new Compartment());
  const suppressOnChange = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const resolveImageSrcRef = useRef(resolveImageSrc);
  resolveImageSrcRef.current = resolveImageSrc;
  const onDocReplacedRef = useRef(onDocReplaced);
  onDocReplacedRef.current = onDocReplaced;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isDark = document.documentElement.classList.contains("dark");
    const theme = isDark ? "dark" : "light";
    const { foldingEnabled, foldingShowControls } = usePreferencesStore.getState();

    const extensions = createExtensions({
      theme,
      themeCompartment: themeCompartment.current,
      keymapCompartment: keymapCompartment.current,
      foldCompartment: foldCompartment.current,
      crossrefCompartment: crossrefCompartment.current,
      noteDirCompartment: noteDirCompartment.current,
      foldConfig: { enabled: foldingEnabled, showControls: foldingShowControls },
      frontmatter,
      noteDir,
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
    onReadyRef.current?.(v);
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
      annotations: docReplaced.of(true),
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
    const v = viewRef.current;
    if (!v) return;
    let prev = {
      enabled: usePreferencesStore.getState().foldingEnabled,
      showControls: usePreferencesStore.getState().foldingShowControls,
    };
    return usePreferencesStore.subscribe((s) => {
      const next = { enabled: s.foldingEnabled, showControls: s.foldingShowControls };
      if (next.enabled === prev.enabled && next.showControls === prev.showControls) return;
      prev = next;
      v.dispatch({
        effects: foldCompartment.current.reconfigure(foldExtension(next)),
      });
    });
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

  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({
      effects: crossrefCompartment.current.reconfigure(
        frontmatterFacet.of(frontmatter ?? {}),
      ),
    });
  }, [frontmatter]);

  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({
      effects: noteDirCompartment.current.reconfigure(
        noteDirFacet.of(noteDir ?? ""),
      ),
    });
  }, [noteDir]);

  return { view };
}
