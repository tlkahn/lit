import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { usePaneStore, findLeaf } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { useCursorInfoStore } from "../stores/cursorInfo";
import { usePageContent } from "../hooks/usePageContent";
import { useKeymaps } from "../hooks/useKeymaps";
import { CodeMirrorEditor } from "../editor/CodeMirrorEditor";
import { resolveRelativePath, getFileDir, frontmatterLineCount } from "../lib/pathUtils";
import { navigateWikilink } from "../lib/wikilinkNavigation";
import { resolveWikilink, createPage as ipcCreatePage } from "../lib/ipc";
import { extractHeadings } from "../lib/headings";
import { globalJumpTracker } from "../editor/jumpTracker";
import {
  registerPaneView,
  unregisterPaneView,
  getPaneView,
  setFocusedPane,
} from "../lib/editorViewRef";

interface EditorPaneProps {
  paneId: string;
}

function EditorPaneInner({ paneId }: EditorPaneProps) {
  const pagePath = usePaneStore((s) => findLeaf(s.root, paneId)?.pagePath ?? null);
  const isFocused = usePaneStore((s) => s.focusedPaneId === paneId);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const triggerReload = useWorkspaceStore((s) => s.triggerReload);
  const refreshPages = useWorkspaceStore((s) => s.refreshPages);

  const { body, frontmatter, rawYaml, handleChange } = usePageContent(paneId, pagePath);
  const { editorBindings } = useKeymaps();

  const currentPathRef = useRef<string | null>(pagePath);
  const rawYamlRef = useRef(rawYaml);
  const isFocusedRef = useRef(isFocused);

  useEffect(() => { currentPathRef.current = pagePath; }, [pagePath]);
  useEffect(() => {
    if (isFocused) {
      useCursorInfoStore.getState().setCursorInfo(0, 0);
    }
  }, [pagePath]);
  useEffect(() => { rawYamlRef.current = rawYaml; }, [rawYaml]);
  useEffect(() => {
    isFocusedRef.current = isFocused;
    if (isFocused) setFocusedPane(paneId);
  }, [isFocused, paneId]);

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

  const handleSelectionChange = useCallback((line: number, col: number) => {
    useCursorInfoStore.getState().setCursorInfo(line, col);
  }, []);

  const handleFocus = useCallback(() => {
    usePaneStore.getState().focusPane(paneId);
    setFocusedPane(paneId);
  }, [paneId]);

  useEffect(() => {
    return () => unregisterPaneView(paneId);
  }, [paneId]);

  const noteDir = useMemo(() => {
    if (!workspacePath || !pagePath) return "";
    const fileDir = getFileDir(pagePath)!;
    return fileDir ? workspacePath + "/" + fileDir : workspacePath;
  }, [workspacePath, pagePath]);

  const resolveImageSrc = useCallback((src: string): string => {
    if (/^(https?:|data:|blob:)/.test(src)) return src;
    if (!workspacePath || !pagePath) return src;
    const fileDir = getFileDir(pagePath)!;
    const absolutePath = workspacePath + "/" + resolveRelativePath(fileDir, src);
    return convertFileSrc(absolutePath);
  }, [workspacePath, pagePath]);

  const openFilePath = useCallback((path: string) => {
    if (path.startsWith("/")) {
      openPath(path);
      return;
    }
    if (!workspacePath || !pagePath) return;
    const fileDir = getFileDir(pagePath)!;
    const absolutePath = workspacePath + "/" + resolveRelativePath(fileDir, path);
    openPath(absolutePath);
  }, [workspacePath, pagePath]);

  const navigateToPage = useCallback((target: string, section?: string, departurePos?: number) => {
    navigateWikilink(target, section, {
      resolveWikilink,
      createPage: async (name: string) => {
        const meta = await ipcCreatePage(name);
        await refreshPages();
        return meta;
      },
      selectPage,
      setPendingSection: (s: string) => useWorkspaceStore.setState({ pendingSection: s }),
      currentPagePath: currentPathRef.current,
      triggerReload,
      recordDeparture: () => {
        const view = getPaneView(paneId);
        const notePath = currentPathRef.current ?? "";
        if (!view || !notePath) return;
        const pos = departurePos ?? view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        globalJumpTracker.recordJump(
          { notePath, line: line.number, col: pos - line.from },
          { notePath: "", line: 0, col: 0 },
        );
        globalJumpTracker.isNavigating = true;
      },
    });
  }, [paneId, selectPage, triggerReload, refreshPages]);

  const handleDocReplaced = useCallback(() => {
    const path = currentPathRef.current;
    if (!path) return;
    const storeState = useWorkspaceStore.getState();
    requestAnimationFrame(() => {
      const view = getPaneView(paneId);
      if (!view) return;
      if (storeState.pendingCursorLine != null) {
        let adjustedLine = storeState.pendingCursorLine;
        if (storeState.pendingCursorFileAbsolute && rawYamlRef.current) {
          adjustedLine = Math.max(1, adjustedLine - frontmatterLineCount(rawYamlRef.current));
        }
        const lineNum = Math.min(adjustedLine, view.state.doc.lines);
        const line = view.state.doc.line(lineNum);
        const col = storeState.pendingCursorCol ?? 0;
        const pos = line.from + Math.min(col, line.length);
        view.dispatch({
          selection: EditorSelection.cursor(pos),
          effects: EditorView.scrollIntoView(pos, { y: "center" }),
        });
        useWorkspaceStore.setState({ pendingCursorLine: null, pendingCursorCol: null, pendingCursorFileAbsolute: false });
      } else if (storeState.pendingSection != null) {
        const section = storeState.pendingSection;
        useWorkspaceStore.setState({ pendingSection: null });
        const docBody = view.state.doc.toString();
        const headings = extractHeadings(docBody);
        const match = headings.find(
          (h) => h.text.toLowerCase() === section.toLowerCase(),
        );
        if (match) {
          const pos = match.from;
          view.dispatch({
            selection: EditorSelection.cursor(pos),
            effects: EditorView.scrollIntoView(pos, { y: "start" }),
          });
        }
      } else {
        const vs = storeState.viewStates[path];
        view.scrollDOM.scrollTop = vs?.scrollTop ?? 0;
        const cursor = Math.min(vs?.cursor ?? 0, view.state.doc.length);
        view.dispatch({ selection: EditorSelection.cursor(cursor) });
      }
      if (isFocusedRef.current) {
        const active = document.activeElement;
        if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
          view.focus();
        }
      }
      globalJumpTracker.isNavigating = false;
    });
  }, [paneId]);

  if (!pagePath) {
    return (
      <div
        data-testid="editor-pane"
        className={`flex min-h-0 flex-1 items-center justify-center border-t-2 ${isFocused ? "border-interactive-accent" : "border-transparent"}`}
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
      className={`flex min-h-0 flex-1 flex-col border-t-2 ${isFocused ? "border-interactive-accent" : "border-transparent"}`}
      onMouseDownCapture={handleFocus}
      onFocus={handleFocus}
      tabIndex={-1}
    >
      <CodeMirrorEditor
        doc={body}
        frontmatter={frontmatter}
        onChange={handleChange}
        onSelectionChange={handleSelectionChange}
        onViewChange={handleViewChange}
        keymapBindings={editorBindings}
        noteDir={noteDir}
        resolveImageSrc={resolveImageSrc}
        openFilePath={openFilePath}
        navigateToPage={navigateToPage}
        onDocReplaced={handleDocReplaced}
      />
    </div>
  );
}

export const EditorPane = React.memo(EditorPaneInner);
