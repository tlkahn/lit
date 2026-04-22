import { useRef, useEffect } from "react";
import { useCodeMirror } from "./useCodeMirror";
import { EditorView } from "@codemirror/view";

interface CodeMirrorEditorProps {
  doc: string;
  onChange?: (content: string) => void;
  resolveImageSrc?: (src: string) => string;
}

export function CodeMirrorEditor({ doc, onChange, resolveImageSrc }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { view } = useCodeMirror({ containerRef, doc, onChange, resolveImageSrc });

  useEffect(() => {
    if (!view) return;
    const handler = (e: Event) => {
      const line = (e as CustomEvent<{ line: number }>).detail.line;
      const doc = view.state.doc;
      const lineNumber = Math.min(line + 1, doc.lines);
      const pos = doc.line(lineNumber).from;
      view.dispatch({
        effects: EditorView.scrollIntoView(pos, { y: "start" }),
      });
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
