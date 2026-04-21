import { useRef } from "react";
import { useCodeMirror } from "./useCodeMirror";

interface CodeMirrorEditorProps {
  doc: string;
  onChange?: (content: string) => void;
  resolveImageSrc?: (src: string) => string;
}

export function CodeMirrorEditor({ doc, onChange, resolveImageSrc }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useCodeMirror({ containerRef, doc, onChange, resolveImageSrc });
  return (
    <div
      ref={containerRef}
      data-testid="editor"
      className="flex-1 overflow-hidden"
    />
  );
}
