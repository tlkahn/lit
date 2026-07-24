import { useRef, useEffect } from "react";
import { useCodeMirror } from "./useCodeMirror";
import { EditorView, type KeyBinding as CM6KeyBinding } from "@codemirror/view";

interface CodeMirrorEditorProps {
  doc: string;
  onChange?: (content: string) => void;
  onSelectionChange?: (line: number, col: number) => void;
  resolveImageSrc?: (src: string) => string[];
  viewRef?: React.RefObject<EditorView | null>;
  onViewChange?: (view: EditorView | null) => void;
  onDocReplaced?: () => void;
  keymapBindings?: CM6KeyBinding[];
  frontmatter?: Record<string, unknown>;
  noteDir?: string;
  notePath?: string;
  openFilePath?: (path: string, fragment: string | null) => void;
  navigateToPage?: (target: string, section?: string, departurePos?: number) => void;
  style?: React.CSSProperties;
}

export function CodeMirrorEditor({ doc, onChange, onSelectionChange, resolveImageSrc, viewRef, onViewChange, onDocReplaced, keymapBindings, frontmatter, noteDir, notePath, openFilePath, navigateToPage, style }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { view } = useCodeMirror({ containerRef, doc, onChange, onSelectionChange, resolveImageSrc, onDocReplaced, keymapBindings, frontmatter, noteDir, notePath, openFilePath, navigateToPage });

  useEffect(() => {
    if (viewRef) {
      (viewRef as React.MutableRefObject<EditorView | null>).current = view;
    }
    if (view) {
      onViewChange?.(view);
      return () => { onViewChange?.(null); };
    }
  }, [view, viewRef, onViewChange]);

  return (
    <div
      ref={containerRef}
      data-testid="editor"
      className="flex-1 overflow-hidden"
      style={style}
    />
  );
}
