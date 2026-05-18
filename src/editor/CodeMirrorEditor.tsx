import { useRef, useEffect } from "react";
import { useCodeMirror } from "./useCodeMirror";
import { EditorView, type KeyBinding as CM6KeyBinding } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

interface CodeMirrorEditorProps {
  doc: string;
  onChange?: (content: string) => void;
  resolveImageSrc?: (src: string) => string;
  viewRef?: React.RefObject<EditorView | null>;
  onViewChange?: (view: EditorView | null) => void;
  onDocReplaced?: () => void;
  keymapBindings?: CM6KeyBinding[];
  frontmatter?: Record<string, unknown>;
  noteDir?: string;
  openFilePath?: (path: string) => void;
  navigateToPage?: (target: string, section?: string, departurePos?: number) => void;
  style?: React.CSSProperties;
}

export function CodeMirrorEditor({ doc, onChange, resolveImageSrc, viewRef, onViewChange, onDocReplaced, keymapBindings, frontmatter, noteDir, openFilePath, navigateToPage, style }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { view } = useCodeMirror({ containerRef, doc, onChange, resolveImageSrc, onDocReplaced, keymapBindings, frontmatter, noteDir, openFilePath, navigateToPage });

  useEffect(() => {
    if (viewRef) {
      (viewRef as React.MutableRefObject<EditorView | null>).current = view;
    }
    if (view) {
      onViewChange?.(view);
      return () => { onViewChange?.(null); };
    }
  }, [view, viewRef, onViewChange]);

  useEffect(() => {
    if (!view) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ line: number; cursor?: boolean }>).detail;
      const doc = view.state.doc;
      const lineNumber = Math.min(detail.line + 1, doc.lines);
      const pos = doc.line(lineNumber).from;
      view.dispatch({
        effects: EditorView.scrollIntoView(pos, { y: "start" }),
        ...(detail.cursor ? { selection: EditorSelection.cursor(pos) } : {}),
      });
      if (detail.cursor) view.focus();
    };
    window.addEventListener("lit:scroll-to-line", handler);
    return () => window.removeEventListener("lit:scroll-to-line", handler);
  }, [view]);

  useEffect(() => {
    if (!view) return;
    const handler = () => view.focus();
    window.addEventListener("lit:request-editor-focus", handler);
    return () => window.removeEventListener("lit:request-editor-focus", handler);
  }, [view]);

  return (
    <div
      ref={containerRef}
      data-testid="editor"
      className="flex-1 overflow-hidden"
      style={style}
    />
  );
}
