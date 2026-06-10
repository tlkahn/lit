import React, { useCallback, useEffect, useRef, useState } from "react";
import type { LanguageSupport } from "@codemirror/language";
import { usePaneStore, findLeaf } from "../stores/panes";
import { useCursorInfoStore } from "../stores/cursorInfo";
import { useCodeFileContent } from "../hooks/useCodeFileContent";
import { useKeymaps } from "../hooks/useKeymaps";
import { useCodeMirrorCode } from "../editor/useCodeMirrorCode";
import { loadLanguage } from "../editor/codeLanguages";
import {
  registerPaneView,
  unregisterPaneView,
  setFocusedPane,
} from "../lib/editorViewRef";

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function CodeEditorPaneInner({ paneId }: { paneId: string }) {
  const pagePath = usePaneStore((s) => findLeaf(s.root, paneId)?.pagePath ?? null);
  const isFocused = usePaneStore((s) => s.focusedPaneId === paneId);

  const { body, handleChange } = useCodeFileContent(paneId, pagePath);
  const { editorBindings } = useKeymaps();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const currentPathRef = useRef<string | null>(pagePath);
  useEffect(() => {
    currentPathRef.current = pagePath;
  }, [pagePath]);

  // Resolve the language lazily, dropping stale async results.
  const [language, setLanguage] = useState<LanguageSupport | null>(null);
  useEffect(() => {
    setLanguage(null);
    if (!pagePath) return;
    loadLanguage(basename(pagePath)).then((lang) => {
      if (currentPathRef.current === pagePath) setLanguage(lang);
    });
  }, [pagePath]);

  // Reset cursor info when switching files while focused.
  useEffect(() => {
    if (isFocused) {
      useCursorInfoStore.getState().setCursorInfo(0, 0);
    }
  }, [pagePath, isFocused]);

  useEffect(() => {
    if (isFocused) setFocusedPane(paneId);
  }, [isFocused, paneId]);

  const handleSelectionChange = useCallback((line: number, col: number) => {
    useCursorInfoStore.getState().setCursorInfo(line, col);
  }, []);

  const { view } = useCodeMirrorCode({
    containerRef,
    doc: body,
    language,
    onChange: handleChange,
    onSelectionChange: handleSelectionChange,
    keymapBindings: editorBindings,
  });

  // Register the view so the status bar / external reload can find it.
  useEffect(() => {
    if (view) {
      registerPaneView(paneId, view);
      return () => unregisterPaneView(paneId);
    }
  }, [view, paneId]);

  const handleFocus = useCallback(() => {
    usePaneStore.getState().focusPane(paneId);
    setFocusedPane(paneId);
  }, [paneId]);

  const emptyContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isFocused && !pagePath) {
      emptyContainerRef.current?.focus();
    }
  }, [isFocused, pagePath]);

  if (!pagePath) {
    return (
      <div
        ref={emptyContainerRef}
        data-testid={`code-editor-pane-${paneId}`}
        data-pane-id={paneId}
        className={`flex min-h-0 flex-1 items-center justify-center border-t-2 ${isFocused ? "border-interactive-accent" : "border-transparent"}`}
        onMouseDownCapture={handleFocus}
        onFocus={handleFocus}
        tabIndex={-1}
      >
        <div data-testid="pane-empty-state">No file selected</div>
      </div>
    );
  }

  return (
    <div
      data-testid={`code-editor-pane-${paneId}`}
      data-pane-id={paneId}
      className={`flex min-h-0 flex-1 flex-col border-t-2 ${isFocused ? "border-interactive-accent" : "border-transparent"}`}
      onMouseDownCapture={handleFocus}
      onFocus={handleFocus}
      tabIndex={-1}
    >
      <div ref={containerRef} className="flex-1 overflow-hidden" />
    </div>
  );
}

const CodeEditorPane = React.memo(CodeEditorPaneInner);
export default CodeEditorPane;
