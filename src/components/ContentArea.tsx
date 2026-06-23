import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../stores/workspace";
import { usePreferencesStore } from "../stores/preferences";
import { usePaneStore, findLeaf } from "../stores/panes";
import { usePaneField, updatePaneContent, type PaneContentEntry } from "../lib/paneContentRegistry";
import { writePage, parseRawYaml, isViewMode, type ViewMode } from "../lib/ipc";
import { executeCommand } from "../lib/commandRegistry";
import { getCurrentEditorView } from "../lib/editorViewRef";
import { PaneContainer } from "./PaneContainer";
import { BottomPanel } from "./BottomPanel";
import { YamlHighlighter } from "./YamlHighlighter";
import { globalJumpTracker } from "../editor/jumpTracker";
import { useGraphViewState } from "../stores/graphViewState";
import { useLeafFileType } from "../hooks/useLeafFileType";
import { HistoryNavButtons } from "./HistoryNavButtons";
import { useAppKeybindings } from "../hooks/useAppKeybindings";

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
  const setPaneViewMode = usePaneStore((s) => s.setPaneViewMode);

  const viewMode: ViewMode = focusedLeaf?.viewMode ?? "editor";

  const pendingTitleFocus = useWorkspaceStore((s) => s.pendingTitleFocus);
  const clearPendingTitleFocus = useWorkspaceStore((s) => s.clearPendingTitleFocus);
  const renamePageAction = useWorkspaceStore((s) => s.renamePage);
  const saveViewState = useWorkspaceStore((s) => s.saveViewState);

  const defaultViewMode = usePreferencesStore((s) => s.defaultViewMode);
  const graphViewEnabled = usePreferencesStore((s) => s.graphViewEnabled);
  const loaded = usePreferencesStore((s) => s.loaded);

  const titleSel = useMemo(() => (e: PaneContentEntry | null) => e?.title ?? "", []);
  const title = usePaneField(focusedPaneId, titleSel);

  const fmSel = useMemo(() => (e: PaneContentEntry | null) => e?.frontmatter ?? EMPTY_FM, []);
  const frontmatter = usePaneField(focusedPaneId, fmSel);

  const rawYamlSel = useMemo(() => (e: PaneContentEntry | null) => e?.rawYaml ?? "", []);
  const rawYaml = usePaneField(focusedPaneId, rawYamlSel);

  const hasCompanion = useWorkspaceStore((s) => s.pages.find((p) => p.relative_path === currentPanePage)?.has_companion ?? false);

  const [editingTitle, setEditingTitle] = useState("");
  const [showFrontmatter, setShowFrontmatter] = useState(false);
  const [editingYaml, setEditingYaml] = useState(false);
  const [yamlDraft, setYamlDraft] = useState("");
  const [yamlError, setYamlError] = useState<string | null>(null);

  const currentPathRef = useRef<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelledRef = useRef(false);
  const defaultViewModeRef = useRef(defaultViewMode);
  defaultViewModeRef.current = defaultViewMode;
  const graphViewEnabledRef = useRef(graphViewEnabled);
  graphViewEnabledRef.current = graphViewEnabled;
  const initialSyncDone = useRef(false);

  useEffect(() => {
    if (loaded && !initialSyncDone.current) {
      initialSyncDone.current = true;
      const mode = defaultViewModeRef.current;
      const resolved = mode === "graph" && !graphViewEnabledRef.current ? "editor" : mode;
      if (resolved !== "editor") {
        setPaneViewMode(focusedPaneId, resolved);
      }
    }
  }, [loaded, focusedPaneId, setPaneViewMode]);

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
    if (previousPath && viewMode === "editor") {
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
  }, [currentPanePage, saveViewState]);

  useEffect(() => {
    if (pendingTitleFocus && title) {
      if (titleInputRef.current) {
        titleInputRef.current.focus();
        titleInputRef.current.select();
        clearPendingTitleFocus();
      }
    }
  }, [pendingTitleFocus, title, clearPendingTitleFocus]);

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
    const setModeHandler = (e: Event) => {
      const mode = (e as CustomEvent<string>).detail;
      if (isViewMode(mode)) {
        if (mode === "graph" && !graphViewEnabledRef.current) return;
        setPaneViewMode(usePaneStore.getState().focusedPaneId, mode);
      }
    };
    const toggleGraphHandler = (e: Event) => {
      if (!graphViewEnabledRef.current) return;
      const detail = (e as CustomEvent<{ mode?: "local" | "full" }>).detail;
      const { focusedPaneId: fpId } = usePaneStore.getState();
      const leaf = findLeaf(usePaneStore.getState().root, fpId);
      const current = leaf?.viewMode ?? "editor";
      setPaneViewMode(fpId, current === "graph" ? "editor" : "graph");
      if (detail?.mode) {
        useGraphViewState.getState().setMode(detail.mode);
      }
    };
    const toggleFrontmatterHandler = () => {
      setShowFrontmatter((prev) => !prev);
    };
    window.addEventListener("lit:set-view-mode", setModeHandler);
    window.addEventListener("lit:toggle-graph-view", toggleGraphHandler);
    window.addEventListener("lit:toggle-frontmatter", toggleFrontmatterHandler);
    return () => {
      window.removeEventListener("lit:set-view-mode", setModeHandler);
      window.removeEventListener("lit:toggle-graph-view", toggleGraphHandler);
      window.removeEventListener("lit:toggle-frontmatter", toggleFrontmatterHandler);
    };
  }, [setPaneViewMode]);

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
      {currentPanePage && focusedFileType === "markdown" && !isMultiPane && (<div className="px-6 py-3">
        <div className="flex items-center gap-2">
          <HistoryNavButtons paneId={focusedPaneId} testIdPrefix="history-" />
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
          {hasCompanion && (
            <button
              onClick={() => executeCommand("companion.open")}
              className="nerd-font flex-shrink-0 text-text-faint opacity-50 hover:opacity-100"
              title="Open companion file"
              data-testid="companion-button"
            >{'󰌷'}</button>
          )}
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
              onClick={() => setPaneViewMode(focusedPaneId, "editor")}
              aria-label="Editor"
              title="Editor (⌘1)"
              className={`rounded-md px-2 py-0.5 text-xs ${viewMode === "editor" ? "bg-bg-hover text-text-normal font-medium" : "text-text-faint hover:text-text-muted"}`}
            >
              Editor
            </button>
            <button
              onClick={() => setPaneViewMode(focusedPaneId, "mindmap")}
              aria-label="Mindmap"
              title="Mindmap (⌘2)"
              className={`rounded-md px-2 py-0.5 text-xs ${viewMode === "mindmap" ? "bg-bg-hover text-text-normal font-medium" : "text-text-faint hover:text-text-muted"}`}
            >
              Mindmap
            </button>
            {graphViewEnabled && (
              <button
                onClick={() => setPaneViewMode(focusedPaneId, "graph")}
                aria-label="Graph"
                title="Graph (⌘3)"
                className={`rounded-md px-2 py-0.5 text-xs ${viewMode === "graph" ? "bg-bg-hover text-text-normal font-medium" : "text-text-faint hover:text-text-muted"}`}
              >
                Graph
              </button>
            )}
            <button
              onClick={() => setPaneViewMode(focusedPaneId, "cardbox")}
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
                <p className="mt-1 text-xs text-red-500" data-testid="yaml-error">
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
      <PaneContainer onExportNetwork={onExportNetwork} />
      {renderBottomPanel && <BottomPanel pageId={currentPanePage ?? undefined} />}
    </main>
  );
}
