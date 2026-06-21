import { useEffect, useState, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../stores/workspace";
import { usePreferencesStore } from "../stores/preferences";
import { usePaneStore, findLeaf } from "../stores/panes";
import { usePaneField, updatePaneContent, type PaneContentEntry } from "../lib/paneContentRegistry";
import { writePage, parseRawYaml, isViewMode, type ViewMode } from "../lib/ipc";
import { executeCommand } from "../lib/commandRegistry";
import { getCurrentEditorView } from "../lib/editorViewRef";
import { extractHeadings } from "../lib/headings";
import { PaneContainer } from "./PaneContainer";
import { BottomPanel } from "./BottomPanel";
import { buildHeadingTree, applyRename, applyMove, insertChild, insertSibling, insertDangling, resolveDeleteFallback, findNode } from "../lib/headingTree";
import { YamlHighlighter } from "./YamlHighlighter";
import { globalJumpTracker } from "../editor/jumpTracker";
import { useGraphViewState } from "../stores/graphViewState";
import { usePaneHistoryStore } from "../stores/paneHistory";
import { useLeafFileType } from "../hooks/useLeafFileType";
import { useAppKeybindings } from "../hooks/useAppKeybindings";
import { CardboxErrorBoundary } from "./CardboxErrorBoundary";

const LazyMindmapView = lazy(() => import("./MindmapView"));
const LazyGraphView = lazy(() => import("./GraphView"));
const LazyCardboxView = lazy(() => import("./CardboxView"));

const EMPTY_FM: Record<string, unknown> = {};

export function parseYamlErrorLocation(msg: string): { line: number; column: number } | null {
  const origin = msg.match(/while parsing .+ at line (\d+) column (\d+)/);
  if (origin) return { line: parseInt(origin[1]!, 10), column: parseInt(origin[2]!, 10) };
  const match = msg.match(/at line (\d+) column (\d+)/);
  if (!match) return null;
  return { line: parseInt(match[1]!, 10), column: parseInt(match[2]!, 10) };
}

export function ContentArea({ onExportNetwork, renderBottomPanel = true }: { onExportNetwork?: (nodeId: string) => void; renderBottomPanel?: boolean } = {}) {
  useAppKeybindings();
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
  const focusedLeaf = usePaneStore((s) => findLeaf(s.root, s.focusedPaneId));
  const currentPanePage = focusedLeaf?.pagePath ?? null;
  const isMultiPane = usePaneStore((s) => s.root.type === "split");
  const focusedFileType = useLeafFileType(focusedPaneId);

  const pendingTitleFocus = useWorkspaceStore((s) => s.pendingTitleFocus);
  const clearPendingTitleFocus = useWorkspaceStore((s) => s.clearPendingTitleFocus);
  const renamePageAction = useWorkspaceStore((s) => s.renamePage);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const saveViewState = useWorkspaceStore((s) => s.saveViewState);
  const saveMindmapFoldState = useWorkspaceStore((s) => s.saveMindmapFoldState);

  const defaultViewMode = usePreferencesStore((s) => s.defaultViewMode);
  const graphViewEnabled = usePreferencesStore((s) => s.graphViewEnabled);
  const loaded = usePreferencesStore((s) => s.loaded);
  const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);

  const titleSel = useMemo(() => (e: PaneContentEntry | null) => e?.title ?? "", []);
  const title = usePaneField(focusedPaneId, titleSel);

  const fmSel = useMemo(() => (e: PaneContentEntry | null) => e?.frontmatter ?? EMPTY_FM, []);
  const frontmatter = usePaneField(focusedPaneId, fmSel);

  const rawYamlSel = useMemo(() => (e: PaneContentEntry | null) => e?.rawYaml ?? "", []);
  const rawYaml = usePaneField(focusedPaneId, rawYamlSel);

  const bodySel = useMemo(
    () => (e: PaneContentEntry | null) => viewMode === "mindmap" ? (e?.body ?? "") : "",
    [viewMode],
  );
  const body = usePaneField(focusedPaneId, bodySel);

  const canGoBack = usePaneHistoryStore((s) => s.canGoBack(focusedPaneId));
  const canGoForward = usePaneHistoryStore((s) => s.canGoForward(focusedPaneId));

  const [mindmapSelectedId, setMindmapSelectedId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [showFrontmatter, setShowFrontmatter] = useState(false);
  const [editingYaml, setEditingYaml] = useState(false);
  const [yamlDraft, setYamlDraft] = useState("");
  const [yamlError, setYamlError] = useState<string | null>(null);

  const currentPathRef = useRef<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelledRef = useRef(false);
  const pendingScrollLineRef = useRef<number | null>(null);
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const defaultViewModeRef = useRef(defaultViewMode);
  defaultViewModeRef.current = defaultViewMode;
  const graphViewEnabledRef = useRef(graphViewEnabled);
  graphViewEnabledRef.current = graphViewEnabled;
  const initialSyncDone = useRef(false);

  useEffect(() => {
    if (loaded && !initialSyncDone.current) {
      initialSyncDone.current = true;
      const mode = defaultViewModeRef.current;
      setViewMode(mode === "graph" && !graphViewEnabledRef.current ? "editor" : mode);
    }
  }, [loaded]);

  useEffect(() => {
    setEditingTitle(title);
  }, [title]);

  const prevPanePageRef = useRef<string | null>(null);
  useEffect(() => {
    const prevPanePage = prevPanePageRef.current;
    prevPanePageRef.current = currentPanePage;
    if (currentPanePage !== null) {
      const current = useWorkspaceStore.getState().currentPagePath;
      if (currentPanePage !== current) {
        useWorkspaceStore.setState({ currentPagePath: currentPanePage });
      }
    } else if (prevPanePage !== null && useWorkspaceStore.getState().currentPagePath !== null) {
      // The focused pane just emptied (last pane closed, or focus moved to an
      // empty pane): clear the mirror. A stale currentPagePath keeps the
      // ErrorBoundary resetKey frozen, lets the mount-effect below resurrect
      // the closed page, and makes re-selecting the same page in the sidebar
      // a no-op. Transition-gated (prevPanePage) so an initial mount with an
      // empty pane doesn't wipe a currentPagePath set before mount — the
      // mount-effect below pushes that into the pane instead.
      useWorkspaceStore.setState({ currentPagePath: null });
    }
  }, [currentPanePage]);

  useEffect(() => {
    const { currentPagePath } = useWorkspaceStore.getState();
    if (currentPagePath) {
      const paneState = usePaneStore.getState();
      const leaf = findLeaf(paneState.root, paneState.focusedPaneId);
      if (leaf?.pagePath !== currentPagePath) {
        paneState.setPanePage(paneState.focusedPaneId, currentPagePath);
      }
    }
    return useWorkspaceStore.subscribe((state, prev) => {
      if (state.currentPagePath !== prev.currentPagePath && state.currentPagePath) {
        const { focusedPaneId: fpId } = usePaneStore.getState();
        const leaf = findLeaf(usePaneStore.getState().root, fpId);
        if (leaf?.pagePath !== state.currentPagePath) {
          usePaneStore.getState().setPanePage(fpId, state.currentPagePath);
        }
      }
    });
  }, []);

  useEffect(() => {
    const previousPath = currentPathRef.current;
    if (previousPath && viewModeRef.current === "editor") {
      const view = getCurrentEditorView();
      if (view) {
        saveViewState(previousPath, view.scrollDOM.scrollTop, view.state.selection.main.head);
        if (!globalJumpTracker.isNavigating) {
          const pos = view.state.selection.main.head;
          const line = view.state.doc.lineAt(pos);
          globalJumpTracker.recordJump(
            { notePath: previousPath, line: line.number, col: pos - line.from },
            { notePath: "", line: 0, col: 0 },
          );
        }
      }
    }
    currentPathRef.current = currentPanePage;
    setEditingYaml(false);
    setYamlDraft("");
    setYamlError(null);
    if (previousPath !== currentPanePage) {
      const mode = defaultViewModeRef.current;
      setViewMode(mode === "graph" && !graphViewEnabledRef.current ? "editor" : mode);
    }
  }, [currentPanePage, saveViewState]);

  useEffect(() => {
    if (pendingTitleFocus && title) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
      clearPendingTitleFocus();
    }
  }, [pendingTitleFocus, title, clearPendingTitleFocus]);

  const headingTree = useMemo(
    () => viewMode === "mindmap" ? buildHeadingTree(extractHeadings(body)) : buildHeadingTree([]),
    [body, viewMode],
  );

  useEffect(() => {
    if (viewMode === "mindmap" && mindmapSelectedId && !findNode(headingTree, mindmapSelectedId)) {
      setMindmapSelectedId(null);
    }
  }, [headingTree, mindmapSelectedId, viewMode]);

  const mindmapInitialFoldedIds = useMemo(() => {
    if (!currentPanePage) return undefined;
    const vs = useWorkspaceStore.getState().viewStates[currentPanePage];
    return vs?.mindmapFoldedIds ? new Set(vs.mindmapFoldedIds) : undefined;
  }, [currentPanePage]);

  const handleFoldChange = useCallback((ids: Set<string>) => {
    if (currentPanePage) {
      saveMindmapFoldState(currentPanePage, Array.from(ids));
    }
  }, [currentPanePage, saveMindmapFoldState]);

  const commitTitle = () => {
    const trimmed = editingTitle.trim();
    if (trimmed && trimmed !== title && currentPanePage) {
      renamePageAction(currentPanePage, trimmed);
      updatePaneContent(focusedPaneId, { title: trimmed });
    } else {
      setEditingTitle(title);
    }
  };

  const enterYamlEdit = () => {
    setYamlDraft(rawYaml);
    setYamlError(null);
    setEditingYaml(true);
    cancelledRef.current = false;
  };

  const commitYamlEdit = async () => {
    if (cancelledRef.current) return;
    try {
      const parsed = await parseRawYaml(yamlDraft);
      setEditingYaml(false);
      setYamlError(null);
      updatePaneContent(focusedPaneId, { frontmatter: parsed, rawYaml: yamlDraft });
      if (currentPanePage) {
        const view = getCurrentEditorView();
        const currentBody = view?.state.doc.toString() ?? "";
        writePage(currentPanePage, currentBody, parsed).catch((err) => {
          console.error("[ContentArea] writePage failed:", err);
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setYamlError(msg);
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        const loc = parseYamlErrorLocation(msg);
        if (loc) {
          const lines = yamlDraft.split("\n");
          let offset = 0;
          for (let i = 0; i < loc.line - 1 && i < lines.length; i++) {
            offset += lines[i]!.length + 1;
          }
          const lineStart = offset;
          const lineEnd = offset + (lines[loc.line - 1]?.length ?? 0);
          ta.setSelectionRange(lineStart, lineEnd);
        }
      }
    }
  };

  const cancelYamlEdit = () => {
    cancelledRef.current = true;
    setYamlDraft("");
    setYamlError(null);
    setEditingYaml(false);
  };

  const autoResizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "0";
    ta.style.height = ta.scrollHeight + "px";
  }, []);

  useEffect(() => {
    if (editingYaml && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
      autoResizeTextarea();
    }
  }, [editingYaml, autoResizeTextarea]);

  useEffect(() => {
    if (!graphViewEnabled && viewMode === "graph") {
      setViewMode("editor");
    }
  }, [graphViewEnabled, viewMode]);

  useEffect(() => {
    if (viewMode !== "editor") return;
    const view = getCurrentEditorView();
    if (!view) return;
    view.requestMeasure();
    const line = pendingScrollLineRef.current;
    if (line == null) return;
    pendingScrollLineRef.current = null;
    const lineNum = Math.min(line + 1, view.state.doc.lines);
    const pos = view.state.doc.line(lineNum).from;
    view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: "start" }),
    });
    view.focus();
  }, [viewMode]);

  useEffect(() => {
    const handler = (e: Event) => {
      if (viewMode !== "mindmap") return;
      const { line } = (e as CustomEvent<{ line: number }>).detail;
      const nodeId = `h-${line}`;
      if (findNode(headingTree, nodeId)) {
        setMindmapSelectedId(nodeId);
      }
    };
    window.addEventListener("lit:scroll-to-line", handler);
    return () => window.removeEventListener("lit:scroll-to-line", handler);
  }, [viewMode, headingTree]);

  useEffect(() => {
    const setModeHandler = (e: Event) => {
      const mode = (e as CustomEvent<string>).detail;
      if (isViewMode(mode)) {
        if (mode === "graph" && !graphViewEnabledRef.current) return;
        setViewMode(mode);
      }
    };
    const toggleGraphHandler = (e: Event) => {
      if (!graphViewEnabledRef.current) return;
      const detail = (e as CustomEvent<{ mode?: "local" | "full" }>).detail;
      setViewMode((prev) => (prev === "graph" ? "editor" : "graph"));
      if (detail?.mode) {
        useGraphViewState.getState().setMode(detail.mode);
      }
    };
    window.addEventListener("lit:set-view-mode", setModeHandler);
    window.addEventListener("lit:toggle-graph-view", toggleGraphHandler);
    return () => {
      window.removeEventListener("lit:set-view-mode", setModeHandler);
      window.removeEventListener("lit:toggle-graph-view", toggleGraphHandler);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("menu://open-in-external-editor", () => {
      const view = getCurrentEditorView();
      if (view) executeCommand("editor.openInExternalEditor", view);
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("menu://close-pane", () => {
      executeCommand("pane.close");
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  if (!currentPanePage && !isMultiPane) {
    return (
      <main
        className="flex min-h-0 flex-1 flex-col bg-bg-primary-alt"
        data-testid="empty-state"
      >
        <div className="flex flex-1 items-center justify-center">
          <p className="text-text-faint">
            Select a page to start editing
          </p>
        </div>
        {renderBottomPanel && <BottomPanel />}
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-bg-primary-alt">
      {currentPanePage && focusedFileType === "markdown" && (<div className="title-bar px-6 py-3">
        <div className="flex items-center gap-2">
          {([
            { dir: "back", can: canGoBack, onClick: () => usePaneHistoryStore.getState().goBack(focusedPaneId), label: "Go back", glyph: "‹" },
            { dir: "forward", can: canGoForward, onClick: () => usePaneHistoryStore.getState().goForward(focusedPaneId), label: "Go forward", glyph: "›" },
          ] as const).map((btn) => (
            <button
              key={btn.dir}
              disabled={!btn.can}
              onClick={btn.onClick}
              className="text-text-faint hover:text-text-normal disabled:opacity-30 disabled:cursor-not-allowed px-0.5"
              aria-label={btn.label}
              data-testid={`history-${btn.dir}`}
            >
              {btn.glyph}
            </button>
          ))}
          <input
            ref={titleInputRef}
            className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-text-normal outline-none"
            data-testid="page-title"
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                titleInputRef.current?.blur();
              }
              if (e.key === "Escape") {
                setEditingTitle(title);
                titleInputRef.current?.blur();
              }
            }}
          />
          {Object.keys(frontmatter).length > 0 && (
            <button
              onClick={() => setShowFrontmatter(!showFrontmatter)}
              className="flex-shrink-0 text-text-faint hover:text-text-muted"
              title={showFrontmatter ? "Hide frontmatter" : "Show frontmatter"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
            </button>
          )}
          <div className="ms-auto flex gap-1">
            <button
              onClick={() => setViewMode("editor")}
              aria-label="Editor"
              title="Editor (⌘1)"
              className={`rounded-md px-2 py-0.5 text-xs ${viewMode === "editor" ? "bg-bg-hover text-text-normal font-medium" : "text-text-faint hover:text-text-muted"}`}
            >
              Editor
            </button>
            <button
              onClick={() => setViewMode("mindmap")}
              aria-label="Mindmap"
              title="Mindmap (⌘2)"
              className={`rounded-md px-2 py-0.5 text-xs ${viewMode === "mindmap" ? "bg-bg-hover text-text-normal font-medium" : "text-text-faint hover:text-text-muted"}`}
            >
              Mindmap
            </button>
            {graphViewEnabled && (
              <button
                onClick={() => setViewMode("graph")}
                aria-label="Graph"
                title="Graph (⌘3)"
                className={`rounded-md px-2 py-0.5 text-xs ${viewMode === "graph" ? "bg-bg-hover text-text-normal font-medium" : "text-text-faint hover:text-text-muted"}`}
              >
                Graph
              </button>
            )}
            <button
              onClick={() => setViewMode("cardbox")}
              aria-label="Cardbox"
              title="Cardbox (⌘4)"
              className={`rounded-md px-2 py-0.5 text-xs ${viewMode === "cardbox" ? "bg-bg-hover text-text-normal font-medium" : "text-text-faint hover:text-text-muted"}`}
            >
              Cardbox
            </button>
          </div>
        </div>
        {showFrontmatter && (
          editingYaml ? (
            <div className="mt-2">
              <textarea
                ref={textareaRef}
                data-testid="frontmatter-editor"
                className="w-full resize-none overflow-hidden rounded bg-bg-secondary p-2 font-mono text-xs text-text-normal outline-none ring-1 ring-interactive-accent"
                value={yamlDraft}
                onChange={(e) => {
                  setYamlDraft(e.target.value);
                  autoResizeTextarea();
                }}
                onBlur={commitYamlEdit}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelYamlEdit();
                  }
                }}
              />
              {yamlError && (
                <p className="mt-1 text-xs text-text-error" data-testid="yaml-error">
                  {yamlError}
                </p>
              )}
            </div>
          ) : (
            <YamlHighlighter
              code={rawYaml}
              className="mt-2 cursor-pointer rounded bg-bg-secondary p-2 text-xs"
              data-testid="frontmatter"
              onClick={enterYamlEdit}
            />
          )
        )}
      </div>)}
      <PaneContainer style={viewMode === "cardbox" || (viewMode !== "editor" && focusedFileType === "markdown") ? { display: "none" } : undefined} />
      {viewMode === "mindmap" && (
        <div
          data-testid="mindmap-view"
          className="flex-1 min-h-0"
        >
          <Suspense fallback={<div className="flex items-center justify-center h-full text-text-faint">Loading…</div>}>
            <LazyMindmapView
              key={currentPanePage}
              tree={headingTree}
              selectedId={mindmapSelectedId}
              initialFoldedIds={mindmapInitialFoldedIds}
              onFoldChange={handleFoldChange}
              onNodeClick={(node) => {
                setMindmapSelectedId(node.id);
              }}
              onNodeRename={(node, newText) => {
                const view = getCurrentEditorView();
                if (!view) return;
                const currentBody = view.state.doc.toString();
                const newBody = applyRename(currentBody, node, newText);
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: newBody } });
              }}
              onNodeMove={(sourceId, targetParentId, targetIndex) => {
                const view = getCurrentEditorView();
                if (!view) return;
                const currentBody = view.state.doc.toString();
                const newBody = applyMove(currentBody, headingTree, sourceId, targetParentId, targetIndex);
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: newBody } });
              }}
              onInsertChild={(parentId, text) => {
                const view = getCurrentEditorView();
                if (!view) return null;
                const currentBody = view.state.doc.toString();
                const result = insertChild(currentBody, headingTree, parentId, text);
                if (!result) return null;
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result.body } });
                setMindmapSelectedId(result.nodeId);
                return result.nodeId;
              }}
              onInsertSibling={(siblingId, text) => {
                const view = getCurrentEditorView();
                if (!view) return null;
                const currentBody = view.state.doc.toString();
                const result = insertSibling(currentBody, headingTree, siblingId, text);
                if (!result) return null;
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result.body } });
                setMindmapSelectedId(result.nodeId);
                return result.nodeId;
              }}
              onInsertDangling={(text) => {
                const view = getCurrentEditorView();
                if (!view) return null;
                const currentBody = view.state.doc.toString();
                const result = insertDangling(currentBody, 2, text);
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result.body } });
                setMindmapSelectedId(result.nodeId);
                return result.nodeId;
              }}
              onNodeJump={(node) => {
                pendingScrollLineRef.current = node.line;
                setViewMode("editor");
              }}
              onDeleteNode={(nodeId) => {
                const view = getCurrentEditorView();
                if (!view) return;
                const currentBody = view.state.doc.toString();
                const { newBody, fallbackId } = resolveDeleteFallback(currentBody, headingTree, nodeId);
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: newBody } });
                setMindmapSelectedId(fallbackId);
              }}
              onExportNetwork={() => {
                if (currentPanePage) onExportNetwork?.(currentPanePage);
              }}
            />
          </Suspense>
        </div>
      )}
      {viewMode === "graph" && (
        <div data-testid="graph-view-wrapper" className="flex-1 min-h-0">
          <Suspense fallback={<div className="flex items-center justify-center h-full text-text-faint">Loading…</div>}>
            <LazyGraphView
              activePageId={currentPanePage}
              onNavigate={(pageId) => {
                selectPage(pageId);
                setViewMode("editor");
              }}
              onExit={() => setViewMode("editor")}
              onExportNetwork={(nodeId) => onExportNetwork?.(nodeId)}
            />
          </Suspense>
        </div>
      )}
      {viewMode === "cardbox" && (
        <div data-testid="cardbox-view-wrapper" className="flex-1 min-h-0 overflow-hidden">
          <CardboxErrorBoundary>
            <Suspense fallback={<div className="flex items-center justify-center h-full text-text-faint">Loading…</div>}>
              <LazyCardboxView />
            </Suspense>
          </CardboxErrorBoundary>
        </div>
      )}
      {renderBottomPanel && <BottomPanel pageId={currentPanePage ?? undefined} />}
    </main>
  );
}
