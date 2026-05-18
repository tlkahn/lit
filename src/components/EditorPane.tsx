import React, { useCallback, useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import { usePaneStore, findLeaf } from "../stores/panes";
import { usePageContent } from "../hooks/usePageContent";
import { CodeMirrorEditor } from "../editor/CodeMirrorEditor";
import {
  registerPaneView,
  unregisterPaneView,
  setFocusedPane,
} from "../lib/editorViewRef";

interface EditorPaneProps {
  paneId: string;
}

function EditorPaneInner({ paneId }: EditorPaneProps) {
  const pagePath = usePaneStore((s) => findLeaf(s.root, paneId)?.pagePath ?? null);
  const isFocused = usePaneStore((s) => s.focusedPaneId === paneId);
  const { body, title, frontmatter, handleChange } = usePageContent(paneId, pagePath);

  const handleViewChange = useCallback(
    (view: EditorView | null) => {
      if (view) {
        registerPaneView(paneId, view);
      } else {
        unregisterPaneView(paneId);
      }
    },
    [paneId],
  );

  const handleFocus = useCallback(() => {
    usePaneStore.getState().focusPane(paneId);
    setFocusedPane(paneId);
  }, [paneId]);

  useEffect(() => {
    return () => unregisterPaneView(paneId);
  }, [paneId]);

  if (!pagePath) {
    return (
      <div
        data-testid="editor-pane"
        className={`flex flex-1 items-center justify-center border-t-2 ${isFocused ? "border-interactive-accent" : "border-transparent"}`}
        onMouseDownCapture={handleFocus}
        onFocus={handleFocus}
        tabIndex={-1}
      >
        <div data-testid="pane-empty-state">No page selected</div>
      </div>
    );
  }

  return (
    <div
      data-testid="editor-pane"
      className={`flex flex-1 flex-col border-t-2 ${isFocused ? "border-interactive-accent" : "border-transparent"}`}
      onMouseDownCapture={handleFocus}
      onFocus={handleFocus}
      tabIndex={-1}
    >
      <div data-testid="pane-breadcrumb">{title}</div>
      <CodeMirrorEditor
        doc={body}
        frontmatter={frontmatter}
        onChange={handleChange}
        onViewChange={handleViewChange}
      />
    </div>
  );
}

export const EditorPane = React.memo(EditorPaneInner);
