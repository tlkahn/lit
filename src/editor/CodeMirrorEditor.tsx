import { useRef } from "react";
import { useCodeMirror } from "./useCodeMirror";

interface CodeMirrorEditorProps {
  doc: string;
  theme: "light" | "dark";
  onChange?: (content: string) => void;
}

export function CodeMirrorEditor({ doc, theme, onChange }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useCodeMirror({ containerRef, doc, theme, onChange });
  return (
    <div
      ref={containerRef}
      data-testid="editor"
      className="flex-1 overflow-hidden"
    />
  );
}
