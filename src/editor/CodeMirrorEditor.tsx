import { useRef, useEffect } from "react";
import { useCodeMirror } from "./useCodeMirror";
import { EditorView, type KeyBinding as CM6KeyBinding } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

interface CodeMirrorEditorProps {
  doc: string;
  onChange?: (content: string) => void;
  resolveImageSrc?: (src: string) => string;
  viewRef?: React.RefObject<EditorView | null>;
  onDocReplaced?: () => void;
  onReady?: (view: EditorView) => void;
  keymapBindings?: CM6KeyBinding[];
  frontmatter?: Record<string, unknown>;
  noteDir?: string;
}

export function CodeMirrorEditor({ doc, onChange, resolveImageSrc, viewRef, onDocReplaced, onReady, keymapBindings, frontmatter, noteDir }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { view } = useCodeMirror({ containerRef, doc, onChange, resolveImageSrc, onDocReplaced, onReady, keymapBindings, frontmatter, noteDir });

  useEffect(() => {
    if (viewRef) {
      (viewRef as React.MutableRefObject<EditorView | null>).current = view;
    }
  }, [view, viewRef]);

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

  return (
    <div
      ref={containerRef}
      data-testid="editor"
      className="flex-1 overflow-hidden"
    />
  );
}
