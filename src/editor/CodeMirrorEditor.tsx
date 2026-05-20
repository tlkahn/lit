import { useRef, useEffect } from "react";
import { useCodeMirror } from "./useCodeMirror";
import { EditorView, type KeyBinding as CM6KeyBinding } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { useWorkspaceStore } from "../stores/workspace";
import type { EditorContext } from "../types";

interface CodeMirrorEditorProps {
  doc: string;
  onChange?: (content: string) => void;
  onSelectionChange?: (line: number, col: number) => void;
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

export function CodeMirrorEditor({ doc, onChange, onSelectionChange, resolveImageSrc, viewRef, onViewChange, onDocReplaced, keymapBindings, frontmatter, noteDir, openFilePath, navigateToPage, style }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { view } = useCodeMirror({ containerRef, doc, onChange, onSelectionChange, resolveImageSrc, onDocReplaced, keymapBindings, frontmatter, noteDir, openFilePath, navigateToPage });

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

  useEffect(() => {
    if (!view) return;
    const handler = (e: Event) => {
      const { text } = (e as CustomEvent<{ text: string }>).detail;
      const pos = view.state.selection.main.head;
      view.dispatch({ changes: { from: pos, insert: text } });
    };
    window.addEventListener("lit:llm-insert-raw", handler);
    return () => window.removeEventListener("lit:llm-insert-raw", handler);
  }, [view]);

  useEffect(() => {
    if (!view) return;
    const handler = (e: Event) => {
      const { callback } = (e as CustomEvent<{ callback: (ctx: EditorContext) => void }>).detail;
      const sel = view.state.selection.main;
      const selectionText = view.state.sliceDoc(sel.from, sel.to);
      const filePath = useWorkspaceStore.getState().currentPagePath ?? "";
      callback({
        selectionText,
        selectionFrom: sel.from,
        selectionTo: sel.to,
        filePath,
      });
    };
    window.addEventListener("lit:llm-request-context", handler);
    return () => window.removeEventListener("lit:llm-request-context", handler);
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
