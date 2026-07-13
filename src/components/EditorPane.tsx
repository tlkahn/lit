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
import { useEmptyPaneFocus } from "../hooks/useEmptyPaneFocus";
import { CodeMirrorEditor } from "../editor/CodeMirrorEditor";
import { resolveRelativePath, getFileDir, isVaultInternalMarkdown } from "../lib/pathUtils";
import { navigateWikilink } from "../lib/wikilinkNavigation";
import { resolveWikilink, createPage as ipcCreatePage } from "../lib/ipc";
import { resolvePendingSection } from "../lib/sectionTarget";
import { dispatchFlashHighlight } from "../editor/livePreview/flashHighlight";
import { globalJumpTracker } from "../editor/jumpTracker";
import { shouldEditorClaimFocus } from "../lib/editorFocus";
import { applyJumpLine, applyPendingCursorLine } from "../lib/editorScroll";
import {
  registerPaneView,
  unregisterPaneView,
  getPaneView,
  setFocusedPane,
} from "../lib/editorViewRef";
import { usePaneFocus } from "../hooks/usePaneFocus";
import { singlePaneFocusBorderClass } from "../lib/paneFocusBorder";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import { getPdfGoToPage, markForwardSync, clearForwardSync } from "../lib/pdfPaneRef";
import { getCachedPageMarkers } from "../lib/pageMarkers";
import { dispatchForwardSync, FORWARD_SYNC_GUARD_MS } from "../lib/forwardSync";
import { dispatchReverseSync } from "../lib/reverseSync";

interface EditorPaneProps {
  paneId: string;
}

function EditorPaneInner({ paneId }: EditorPaneProps) {
  const pagePath = usePaneStore((s) => findLeaf(s.root, paneId)?.pagePath ?? null);
  const viewMode = usePaneStore((s) => findLeaf(s.root, paneId)?.viewMode ?? "editor");
  const isFocused = usePaneStore((s) => s.focusedPaneId === paneId);
  const isMultiPane = usePaneStore((s) => s.root.type === "split");
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const triggerReload = useWorkspaceStore((s) => s.triggerReload);
  const refreshPages = useWorkspaceStore((s) => s.refreshPages);

  const { body, frontmatter, rawYaml, handleChange } = usePageContent(paneId, pagePath);
  const { editorBindings } = useKeymaps();

  const currentPathRef = useRef<string | null>(pagePath);
  const rawYamlRef = useRef(rawYaml);
  const isFocusedRef = useRef(isFocused);
  const docLoadedForPathRef = useRef<string | null>(null);

  useEffect(() => { currentPathRef.current = pagePath; }, [pagePath]);
  useEffect(() => { docLoadedForPathRef.current = null; }, [pagePath]);
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

    const linked = usePanePdfLinkStore.getState().getLinkedPane(paneId);
    if (!linked) return;
    const view = getPaneView(paneId);
    if (!view) return;
    dispatchForwardSync({
      editorPaneId: paneId,
      // The offset and markers are read inside this fire-time callback (not at
      // schedule time) so a document edit during the debounce window — one that
      // mutates the doc/cursor without re-firing onSelectionChange — cannot make
      // them stale. Re-read the live view here so the latest state.doc/selection
      // is used; null if the view disappeared mid-debounce. CodeMirror's doc is
      // the frontmatter-stripped body, so both the markers and the offset live
      // in the same coordinate space (no FM adjustment).
      read: () => {
        const v = getPaneView(paneId);
        if (!v) return null;
        return {
          offset: v.state.selection.main.head,
          markers: getCachedPageMarkers(v.state.doc),
        };
      },
      // The lastSyncedPage echo guard lives in dispatchForwardSync's fire path
      // (it consults the panePdfLink store), so reverse sync (PDF -> md) cannot
      // bounce back into forward sync. No guard wrapping needed here.
      // The page offset is applied inside dispatchForwardSync, so goToPage
      // receives the already-offset-adjusted PDF page index.
      goToPage: (pageIndex) => {
        const linkedNow = usePanePdfLinkStore.getState().getLinkedPane(paneId);
        if (!linkedNow) return;
        const goFn = getPdfGoToPage(linkedNow);
        if (!goFn) return;
        const token = markForwardSync(linkedNow);
        goFn(pageIndex);
        setTimeout(() => clearForwardSync(linkedNow, token), FORWARD_SYNC_GUARD_MS);
      },
    });
  }, [paneId]);

  const handleFocus = usePaneFocus(paneId);

  useEffect(() => {
    return () => unregisterPaneView(paneId);
  }, [paneId]);

  useEffect(() => {
    const handler = (e: Event) => {
      if (usePaneStore.getState().focusedPaneId !== paneId) return;
      const leaf = findLeaf(usePaneStore.getState().root, paneId);
      if (!leaf || (leaf.viewMode && leaf.viewMode !== "editor")) return;
      const view = getPaneView(paneId);
      if (!view) return;
      const detail = (e as CustomEvent<{ line: number; cursor?: boolean }>).detail;
      const lineNumber = Math.min(detail.line + 1, view.state.doc.lines);
      const pos = view.state.doc.line(lineNumber).from;
      view.dispatch({
        effects: EditorView.scrollIntoView(pos, { y: "start" }),
        ...(detail.cursor ? { selection: EditorSelection.cursor(pos) } : {}),
      });
      if (detail.cursor) view.focus();
    };
    window.addEventListener("lit:scroll-to-line", handler);
    return () => window.removeEventListener("lit:scroll-to-line", handler);
  }, [paneId]);

  useEffect(() => {
    const handler = () => {
      if (usePaneStore.getState().focusedPaneId !== paneId) return;
      const leaf = findLeaf(usePaneStore.getState().root, paneId);
      if (!leaf || (leaf.viewMode && leaf.viewMode !== "editor")) return;
      getPaneView(paneId)?.focus();
    };
    window.addEventListener("lit:request-editor-focus", handler);
    return () => window.removeEventListener("lit:request-editor-focus", handler);
  }, [paneId]);

  const noteDir = useMemo(() => {
    if (!pagePath) return "";
    if (pagePath.startsWith("/")) {
      const dir = getFileDir(pagePath)!;
      return dir || "/";
    }
    if (!workspacePath) return "";
    const fileDir = getFileDir(pagePath)!;
    return fileDir ? workspacePath + "/" + fileDir : workspacePath;
  }, [workspacePath, pagePath]);

  const resolveImageSrc = useCallback((src: string): string => {
    if (/^(https?:|data:|blob:)/.test(src)) return src;
    if (!noteDir) return src;
    return convertFileSrc("/" + resolveRelativePath(noteDir, src));
  }, [noteDir]);

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

  const openFilePath = useCallback((path: string, fragment: string | null = null) => {
    if (path.startsWith("/")) {
      openPath(path);
      return;
    }
    if (isVaultInternalMarkdown(path)) {
      const target = path.replace(/^\.\//, "").replace(/\.md$/i, "");
      navigateToPage(target, fragment ?? undefined);
      return;
    }
    if (!noteDir) return;
    openPath("/" + resolveRelativePath(noteDir, path));
  }, [noteDir, navigateToPage]);

  const handleDocReplaced = useCallback(() => {
    const path = currentPathRef.current;
    if (!path) return;
    const storeState = useWorkspaceStore.getState();
    requestAnimationFrame(() => {
      const view = getPaneView(paneId);
      if (!view) return;
      const pendingJumpLine = usePaneStore.getState().consumePendingJumpLine(paneId);
      if (pendingJumpLine != null) {
        applyJumpLine(view, pendingJumpLine);
      } else {
      const pendingSync = usePanePdfLinkStore.getState().consumePendingEditorSync(paneId);
      if (pendingSync !== null) {
        const markers = getCachedPageMarkers(view.state.doc);
        dispatchReverseSync(pendingSync, paneId, markers, {
          skipGuards: true,
          clampIndex: true,
        });
      } else if (storeState.pendingCursorLine != null) {
        applyPendingCursorLine(view, storeState.pendingCursorLine, storeState.pendingCursorCol, storeState.pendingCursorFileAbsolute, rawYamlRef.current);
        useWorkspaceStore.setState({ pendingCursorLine: null, pendingCursorCol: null, pendingCursorFileAbsolute: false });
      } else if (storeState.pendingSection != null) {
        const section = storeState.pendingSection;
        useWorkspaceStore.setState({ pendingSection: null });
        const docBody = view.state.doc.toString();
        const target = resolvePendingSection(docBody, section);
        if (target) {
          view.dispatch({
            selection: EditorSelection.cursor(target.pos),
            effects: EditorView.scrollIntoView(target.pos, { y: "start" }),
          });
          if (target.flash) {
            dispatchFlashHighlight(view, target.flash.from, target.flash.to);
          }
        }
      } else {
        const vs = storeState.viewStates[path];
        view.scrollDOM.scrollTop = vs?.scrollTop ?? 0;
        const cursor = Math.min(vs?.cursor ?? 0, view.state.doc.length);
        view.dispatch({ selection: EditorSelection.cursor(cursor) });
      }
      }
      docLoadedForPathRef.current = currentPathRef.current;
      if (isFocusedRef.current && shouldEditorClaimFocus(document.activeElement)) {
        view.focus();
      }
      globalJumpTracker.isNavigating = false;
    });
  }, [paneId]);

  // Consume pendingJumpLine when viewMode transitions to "editor" on the same
  // page (e.g. clicking "jump to heading" in mindmap view). In that scenario
  // the doc prop does not change, so handleDocReplaced never fires and the
  // pending jump would otherwise go stale. consumePendingJumpLine is atomic —
  // if handleDocReplaced already consumed it, this is a harmless no-op.
  // A ref tracks the previous viewMode so we only fire on an actual transition,
  // not on initial mount when viewMode is already "editor".
  const prevViewModeRef = useRef(viewMode);
  useEffect(() => {
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;
    if (viewMode !== "editor" || prev === "editor") return;
    requestAnimationFrame(() => {
      const view = getPaneView(paneId);
      if (!view) return;
      const pendingJumpLine = usePaneStore.getState().consumePendingJumpLine(paneId);
      if (pendingJumpLine != null) {
        applyJumpLine(view, pendingJumpLine);
        return;
      }
      const wsState = useWorkspaceStore.getState();
      if (wsState.pendingCursorLine != null && docLoadedForPathRef.current === currentPathRef.current) {
        applyPendingCursorLine(view, wsState.pendingCursorLine, wsState.pendingCursorCol, wsState.pendingCursorFileAbsolute, rawYamlRef.current);
        useWorkspaceStore.setState({ pendingCursorLine: null, pendingCursorCol: null, pendingCursorFileAbsolute: false });
      }
    });
  }, [viewMode, paneId]);

  const emptyContainerRef = useEmptyPaneFocus(isFocused, pagePath);

  if (!pagePath) {
    return (
      <div
        ref={emptyContainerRef}
        data-testid="editor-pane"
        data-pane-id={paneId}
        className={`flex min-h-0 flex-1 items-center justify-center ${singlePaneFocusBorderClass(isMultiPane, isFocused)}`}
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
      data-pane-id={paneId}
      className={`flex min-h-0 flex-1 flex-col ${singlePaneFocusBorderClass(isMultiPane, isFocused)}`}
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
        notePath={pagePath ?? ""}
        resolveImageSrc={resolveImageSrc}
        openFilePath={openFilePath}
        navigateToPage={navigateToPage}
        onDocReplaced={handleDocReplaced}
      />
    </div>
  );
}

export const EditorPane = React.memo(EditorPaneInner);
