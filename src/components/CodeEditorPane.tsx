import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LanguageSupport } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { usePaneStore, findLeaf } from "../stores/panes";
import { useCursorInfoStore } from "../stores/cursorInfo";
import { useCodeFileContent } from "../hooks/useCodeFileContent";
import { useKeymaps } from "../hooks/useKeymaps";
import { useCodeMirrorCode } from "../editor/useCodeMirrorCode";
import { loadLanguage } from "../editor/codeLanguages";
import { useEmptyPaneFocus } from "../hooks/useEmptyPaneFocus";
import {
  registerPaneView,
  unregisterPaneView,
  setFocusedPane,
  getPaneView,
} from "../lib/editorViewRef";
import { useWorkspaceStore } from "../stores/workspace";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { bibFileLinkExtension } from "../editor/bibFileLink";

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

  const extraExtensions = useMemo((): Extension[] | undefined => {
    if (!pagePath?.endsWith(".bib")) return undefined;
    return [bibFileLinkExtension(pagePath)];
  }, [pagePath]);

  const handleDocReplaced = useCallback(() => {
    requestAnimationFrame(() => {
      const view = getPaneView(paneId);
      if (!view) return;
      const { pendingCursorLine, pendingCursorCol } = useWorkspaceStore.getState();
      if (pendingCursorLine != null) {
        const lineNum = Math.min(pendingCursorLine, view.state.doc.lines);
        const line = view.state.doc.line(lineNum);
        const col = pendingCursorCol ?? 0;
        const pos = line.from + Math.min(col, line.length);
        view.dispatch({
          selection: EditorSelection.cursor(pos),
          effects: EditorView.scrollIntoView(pos, { y: "center" }),
        });
        useWorkspaceStore.setState({ pendingCursorLine: null, pendingCursorCol: null, pendingCursorFileAbsolute: false });
      }
      const focusedPaneId = usePaneStore.getState().focusedPaneId;
      if (focusedPaneId === paneId) {
        const active = document.activeElement;
        if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
          view.focus();
        }
      }
    });
  }, [paneId]);

  const { view } = useCodeMirrorCode({
    containerRef,
    doc: body,
    language,
    onChange: handleChange,
    onSelectionChange: handleSelectionChange,
    keymapBindings: editorBindings,
    onDocReplaced: handleDocReplaced,
    extraExtensions,
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

  const emptyContainerRef = useEmptyPaneFocus(isFocused, pagePath);

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
