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
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import { getPdfGoToPage, markForwardSync, clearForwardSync } from "../lib/pdfPaneRef";
import { getCachedPageMarkers } from "../lib/pageMarkers";
import { dispatchForwardSync } from "../lib/forwardSync";

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

    // Forward sync (md -> PDF): if this editor pane is linked to a PDF pane,
    // jump the PDF to the page whose marker precedes the cursor. The real char
    // offset is not available from (line, col) — read it from the live view.
    const linked = usePanePdfLinkStore.getState().getLinkedPane(paneId);
    if (!linked) return;
    const view = getPaneView(paneId);
    if (!view) return;
    // CodeMirror's doc is the frontmatter-stripped body, so both the markers
    // and the offset live in the same coordinate space (no FM adjustment).
    const offset = view.state.selection.main.head;
    const markers = getCachedPageMarkers(view.state.doc);
    dispatchForwardSync({
      offset,
      markers,
      // The lastSyncedPage echo guard lives in dispatchForwardSync's fire path
      // (it consults the panePdfLink store), so reverse sync (PDF -> md) cannot
      // bounce back into forward sync. No guard wrapping needed here.
      goToPage: (pageIndex) => {
        // Re-read the link at FIRE time, not the schedule-time `linked` capture:
        // if the user unlinks during the debounce window, syncEnabled stays true
        // and the echo guard passes, so without this re-check forward sync would
        // navigate a PDF pane that is no longer linked. Mirrors the fire-time
        // syncEnabled re-check in forwardSync.ts. Bail out before minting any
        // token so no clearForwardSync timeout is scheduled.
        const linkedNow = usePanePdfLinkStore.getState().getLinkedPane(paneId);
        if (!linkedNow) return;
        const token = markForwardSync(linkedNow);
        getPdfGoToPage(linkedNow)?.(pageIndex);
        // Safety net: if goToPage's same-page guard returned early without
        // firing onPageChange, the flag would linger. The cleanup is token-
        // scoped, so it only clears this navigation's flag — and only if no
        // newer navigation or (slow) onPageChange has already replaced/consumed
        // it. This makes a late timeout a no-op instead of clobbering a slow
        // real navigation's in-flight flag (which would cause a cursor bounce).
        setTimeout(() => clearForwardSync(linkedNow, token), 500);
      },
    });
  }, [paneId]);

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
