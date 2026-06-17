import { useRef, useEffect } from "react";
import { useCodeMirror } from "./useCodeMirror";
import { EditorView, type KeyBinding as CM6KeyBinding } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

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
  notePath?: string;
  openFilePath?: (path: string) => void;
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

  useEffect(() => {
    if (!view) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ line: number; cursor?: boolean; flash?: boolean }>).detail;
      const doc = view.state.doc;
      const lineNumber = Math.min(detail.line + 1, doc.lines);
      const pos = doc.line(lineNumber).from;
      view.dispatch({
        effects: EditorView.scrollIntoView(pos, { y: "start" }),
        ...(detail.cursor ? { selection: EditorSelection.cursor(pos) } : {}),
      });
      if (detail.cursor) view.focus();

      // Flash the target line for visual orientation
      if (detail.flash === true) {
        requestAnimationFrame(() => {
          try {
            const lineBlock = view.lineBlockAt(pos);
            const domNode = view.domAtPos(lineBlock.from)?.node;
            const lineEl = domNode instanceof HTMLElement
              ? domNode.closest(".cm-line")
              : domNode?.parentElement?.closest(".cm-line");
            if (lineEl) {
              lineEl.classList.remove("cm-line-flash");
              // Force reflow to restart animation if same line
              void (lineEl as HTMLElement).offsetWidth;
              lineEl.classList.add("cm-line-flash");
              lineEl.addEventListener("animationend", () => {
                lineEl.classList.remove("cm-line-flash");
              }, { once: true });
            }
          } catch {
            // Non-critical visual effect — ignore DOM errors (e.g. in test environments)
          }
        });
      }
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
