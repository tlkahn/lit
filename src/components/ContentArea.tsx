import { useEffect, useState, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../stores/workspace";
import { readPage, writePage, parseRawYaml, resolveWikilink, createPage as ipcCreatePage } from "../lib/ipc";
import { executeCommand } from "../lib/commandRegistry";
import { navigateWikilink } from "../lib/wikilinkNavigation";
import { setCurrentEditorView } from "../lib/editorViewRef";
import { extractHeadings, type Heading } from "../lib/headings";
import { CodeMirrorEditor } from "../editor/CodeMirrorEditor";
import { PdfViewer } from "./PdfViewer";
import { BottomPanel } from "./BottomPanel";
import { ConflictDialog } from "./ConflictDialog";
import { buildHeadingTree, applyRename, applyMove, insertChild, insertSibling, insertDangling, resolveDeleteFallback, findNode } from "../lib/headingTree";
import { YamlHighlighter } from "./YamlHighlighter";
import { useKeymaps } from "../hooks/useKeymaps";
import { useModalLock } from "../hooks/useModalLock";

const LazyMindmapView = lazy(() => import("./MindmapView"));
const LazyGraphView = lazy(() => import("./GraphView"));

import { globalJumpTracker } from "../editor/jumpTracker";

export function parseYamlErrorLocation(msg: string): { line: number; column: number } | null {
  const origin = msg.match(/while parsing .+ at line (\d+) column (\d+)/);
  if (origin) return { line: parseInt(origin[1]!, 10), column: parseInt(origin[2]!, 10) };
  const match = msg.match(/at line (\d+) column (\d+)/);
  if (!match) return null;
  return { line: parseInt(match[1]!, 10), column: parseInt(match[2]!, 10) };
}

function resolveRelativePath(base: string, relative: string): string {
  const segments = (base ? base + "/" + relative : relative).split("/");
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === "..") resolved.pop();
    else if (seg !== "." && seg !== "") resolved.push(seg);
  }
  return resolved.join("/");
}

function frontmatterLineCount(rawYaml: string): number {
  if (!rawYaml) return 0;
  return rawYaml.trimEnd().split("\n").length + 2;
}

export function ContentArea() {
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const pendingTitleFocus = useWorkspaceStore((s) => s.pendingTitleFocus);
  const clearPendingTitleFocus = useWorkspaceStore((s) => s.clearPendingTitleFocus);
  const renamePageAction = useWorkspaceStore((s) => s.renamePage);
  const setCurrentPageHeadings = useWorkspaceStore((s) => s.setCurrentPageHeadings);
  const isDirty = useWorkspaceStore((s) => s.isDirty);
  const setDirty = useWorkspaceStore((s) => s.setDirty);
  const reloadTrigger = useWorkspaceStore((s) => s.reloadTrigger);
  const saveViewState = useWorkspaceStore((s) => s.saveViewState);
  const saveMindmapFoldState = useWorkspaceStore((s) => s.saveMindmapFoldState);

  const { editorBindings } = useKeymaps();
  const editorViewRef = useRef<EditorView | null>(null);
  const [body, setBody] = useState("");
  const [viewMode, setViewMode] = useState<"editor" | "mindmap" | "graph">("editor");
  const [graphInitialMode, setGraphInitialMode] = useState<"full" | "local" | undefined>(undefined);
  const [graphEverOpened, setGraphEverOpened] = useState(false);
  const [mindmapSelectedId, setMindmapSelectedId] = useState<string | null>(null);
  const [showConflict, setShowConflict] = useState(false);
  useModalLock(showConflict);
  const [title, setTitle] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
  const [rawYaml, setRawYaml] = useState("");
  const [showFrontmatter, setShowFrontmatter] = useState(false);
  const [editingYaml, setEditingYaml] = useState(false);
  const [yamlDraft, setYamlDraft] = useState("");
  const [yamlError, setYamlError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingsRef = useRef<Heading[]>([]);
  const editGenRef = useRef(0);
  const currentPathRef = useRef<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelledRef = useRef(false);
  const pendingScrollLineRef = useRef<number | null>(null);
  const rawYamlRef = useRef("");

  const loadPage = useCallback(async (path: string) => {
    try {
      const content = await readPage(path);
      if (currentPathRef.current === path) {
        console.debug("[ContentArea] loadPage OK:", path, "body length:", content.body.length);
        setBody(content.body);
        setTitle(content.meta.title);
        setEditingTitle(content.meta.title);
        setFrontmatter(content.meta.frontmatter);
        setRawYaml(content.raw_yaml);
        rawYamlRef.current = content.raw_yaml;
        useWorkspaceStore.getState().setCurrentFrontmatterLineCount(frontmatterLineCount(content.raw_yaml));
        setCurrentPageHeadings(extractHeadings(content.body));
      } else {
        console.debug("[ContentArea] loadPage stale, ignoring:", path);
      }
    } catch (err) {
      console.error("[ContentArea] loadPage failed:", path, err);
      setBody("");
      setTitle("");
      setEditingTitle("");
      setFrontmatter({});
      setRawYaml("");
      rawYamlRef.current = "";
      setCurrentPageHeadings([]);
    }
  }, [setCurrentPageHeadings]);

  useEffect(() => {
    const previousPath = currentPathRef.current;
    if (previousPath && editorViewRef.current) {
      const view = editorViewRef.current;
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
    currentPathRef.current = currentPagePath;
    if (currentPagePath) {
      const { pages: currentPages } = useWorkspaceStore.getState();
      const page = currentPages.find(p => p.relative_path === currentPagePath);
      if (page?.file_type === 'pdf') {
        return;
      }
      loadPage(currentPagePath);
    } else {
      setBody("");
      setTitle("");
      setEditingTitle("");
      setFrontmatter({});
      setRawYaml("");
      rawYamlRef.current = "";
    }
    setEditingYaml(false);
    setYamlDraft("");
    setYamlError(null);
    setShowConflict(false);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (headingDebounceRef.current) clearTimeout(headingDebounceRef.current);
    };
  }, [currentPagePath, loadPage, saveViewState]);

  useEffect(() => {
    if (pendingTitleFocus && title) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
      clearPendingTitleFocus();
    }
  }, [pendingTitleFocus, title, clearPendingTitleFocus]);

  useEffect(() => {
    if (reloadTrigger === 0 || !currentPagePath) return;
    if (isDirty) {
      setShowConflict(true);
    } else {
      loadPage(currentPagePath);
    }
  }, [reloadTrigger, currentPagePath, isDirty, loadPage]);

  const resolveImageSrc = useCallback((src: string): string => {
    if (/^(https?:|data:|blob:)/.test(src)) return src;
    if (!workspacePath || !currentPagePath) return src;

    const lastSlash = currentPagePath.lastIndexOf("/");
    const fileDir = lastSlash >= 0 ? currentPagePath.substring(0, lastSlash) : "";
    const absolutePath = workspacePath + "/" + resolveRelativePath(fileDir, src);
    return convertFileSrc(absolutePath);
  }, [workspacePath, currentPagePath]);

  const openFilePath = useCallback((path: string) => {
    if (path.startsWith("/")) {
      openPath(path);
      return;
    }
    if (!workspacePath || !currentPagePath) return;
    const lastSlash = currentPagePath.lastIndexOf("/");
    const fileDir = lastSlash >= 0 ? currentPagePath.substring(0, lastSlash) : "";
    const absolutePath = workspacePath + "/" + resolveRelativePath(fileDir, path);
    openPath(absolutePath);
  }, [workspacePath, currentPagePath]);

  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const triggerReload = useWorkspaceStore((s) => s.triggerReload);
  const refreshPages = useWorkspaceStore((s) => s.refreshPages);

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
        const view = editorViewRef.current;
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
  }, [selectPage, triggerReload, refreshPages]);

  const noteDir = useMemo(() => {
    if (!workspacePath || !currentPagePath) return "";
    const lastSlash = currentPagePath.lastIndexOf("/");
    const fileDir = lastSlash >= 0 ? currentPagePath.substring(0, lastSlash) : "";
    return fileDir ? workspacePath + "/" + fileDir : workspacePath;
  }, [workspacePath, currentPagePath]);

  const handleDocReplaced = useCallback(() => {
    const path = currentPathRef.current;
    if (!path) return;
    const storeState = useWorkspaceStore.getState();
    requestAnimationFrame(() => {
      const view = editorViewRef.current;
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
      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
        view.focus();
      }
      globalJumpTracker.isNavigating = false;
    });
  }, []);

  const commitTitle = () => {
    const trimmed = editingTitle.trim();
    if (trimmed && trimmed !== title && currentPagePath) {
      renamePageAction(currentPagePath, trimmed);
      setTitle(trimmed);
    } else {
      setEditingTitle(title);
    }
  };

  const handleChange = (newBody: string) => {
    setBody(newBody);
    setDirty(true);
    const gen = ++editGenRef.current;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (currentPagePath) {
        writePage(currentPagePath, newBody, frontmatter)
          .then(() => {
            if (editGenRef.current === gen) setDirty(false);
          })
          .catch((err) => {
            console.error("[ContentArea] writePage failed:", err);
          });
      }
    }, 300);
    if (headingDebounceRef.current) clearTimeout(headingDebounceRef.current);
    headingDebounceRef.current = setTimeout(() => {
      setCurrentPageHeadings(headingsRef.current);
    }, 150);
  };

  const headingTree = useMemo(() => {
    const h = extractHeadings(body);
    headingsRef.current = h;
    return buildHeadingTree(h);
  }, [body]);

  useEffect(() => {
    if (mindmapSelectedId && !findNode(headingTree, mindmapSelectedId)) {
      setMindmapSelectedId(null);
    }
  }, [headingTree, mindmapSelectedId]);

  const mindmapInitialFoldedIds = useMemo(() => {
    if (!currentPagePath) return undefined;
    const vs = useWorkspaceStore.getState().viewStates[currentPagePath];
    return vs?.mindmapFoldedIds ? new Set(vs.mindmapFoldedIds) : undefined;
  }, [currentPagePath]);

  const handleFoldChange = useCallback((ids: Set<string>) => {
    if (currentPagePath) {
      saveMindmapFoldState(currentPagePath, Array.from(ids));
    }
  }, [currentPagePath, saveMindmapFoldState]);

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
      setFrontmatter(parsed);
      setRawYaml(yamlDraft);
      setEditingYaml(false);
      setYamlError(null);
      if (currentPagePath) {
        writePage(currentPagePath, body, parsed).catch((err) => {
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
    setCurrentEditorView(editorViewRef.current);
    return () => setCurrentEditorView(null);
  });

  useEffect(() => {
    if (viewMode === "graph" && !graphEverOpened) setGraphEverOpened(true);
  }, [viewMode, graphEverOpened]);

  useEffect(() => {
    if (viewMode !== "editor") return;
    const view = editorViewRef.current;
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
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ mode?: "local" | "full" }>).detail;
      setViewMode((prev) => (prev === "graph" ? "editor" : "graph"));
      setGraphInitialMode(detail?.mode ?? undefined);
    };
    window.addEventListener("lit:toggle-graph-view", handler);
    return () => window.removeEventListener("lit:toggle-graph-view", handler);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("menu://open-in-external-editor", () => {
      const view = editorViewRef.current;
      if (view) executeCommand("editor.openInExternalEditor", view);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  if (!currentPagePath) {
    return (
      <main
        className="flex flex-1 items-center justify-center bg-bg-primary-alt"
        data-testid="empty-state"
      >
        <p className="text-text-faint">
          Select a page to start editing
        </p>
      </main>
    );
  }

  const currentPageMeta = useWorkspaceStore.getState().pages.find(
    (p) => p.relative_path === currentPagePath,
  );
  if (currentPageMeta?.file_type === "pdf" && workspacePath) {
    return <PdfViewer filePath={`${workspacePath}/${currentPagePath}`} />;
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-bg-primary-alt">
      <div className="px-6 py-3">
        <div className="flex items-center gap-2">
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
              className={`rounded px-2 py-0.5 text-xs ${viewMode === "editor" ? "bg-interactive-accent text-white" : "text-text-faint hover:text-text-muted"}`}
            >
              Editor
            </button>
            <button
              onClick={() => setViewMode("mindmap")}
              aria-label="Mindmap"
              className={`rounded px-2 py-0.5 text-xs ${viewMode === "mindmap" ? "bg-interactive-accent text-white" : "text-text-faint hover:text-text-muted"}`}
            >
              Mindmap
            </button>
            <button
              onClick={() => { setGraphInitialMode(undefined); setViewMode("graph"); }}
              aria-label="Graph"
              className={`rounded px-2 py-0.5 text-xs ${viewMode === "graph" ? "bg-interactive-accent text-white" : "text-text-faint hover:text-text-muted"}`}
            >
              Graph
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
      </div>
      <CodeMirrorEditor
        doc={body}
        onChange={handleChange}
        resolveImageSrc={resolveImageSrc}
        viewRef={editorViewRef}
        onDocReplaced={handleDocReplaced}
        keymapBindings={editorBindings}
        frontmatter={frontmatter}
        noteDir={noteDir}
        openFilePath={openFilePath}
        navigateToPage={navigateToPage}
        style={viewMode !== "editor" ? { display: "none" } : undefined}
      />
      {viewMode === "mindmap" && (
        <div
          data-testid="mindmap-view"
          className="flex-1 min-h-0"
        >
          <Suspense fallback={<div className="flex items-center justify-center h-full text-text-faint">Loading…</div>}>
            <LazyMindmapView
              key={currentPagePath}
              tree={headingTree}
              selectedId={mindmapSelectedId}
              initialFoldedIds={mindmapInitialFoldedIds}
              onFoldChange={handleFoldChange}
              onNodeClick={(node) => {
                setMindmapSelectedId(node.id);
              }}
              onNodeRename={(node, newText) => {
                const newBody = applyRename(body, node, newText);
                handleChange(newBody);
              }}
              onNodeMove={(sourceId, targetParentId, targetIndex) => {
                const newBody = applyMove(body, headingTree, sourceId, targetParentId, targetIndex);
                handleChange(newBody);
              }}
              onInsertChild={(parentId, text) => {
                const result = insertChild(body, headingTree, parentId, text);
                if (!result) return null;
                handleChange(result.body);
                setMindmapSelectedId(result.nodeId);
                return result.nodeId;
              }}
              onInsertSibling={(siblingId, text) => {
                const result = insertSibling(body, headingTree, siblingId, text);
                if (!result) return null;
                handleChange(result.body);
                setMindmapSelectedId(result.nodeId);
                return result.nodeId;
              }}
              onInsertDangling={(text) => {
                const result = insertDangling(body, 2, text);
                handleChange(result.body);
                setMindmapSelectedId(result.nodeId);
                return result.nodeId;
              }}
              onNodeJump={(node) => {
                pendingScrollLineRef.current = node.line;
                setViewMode("editor");
              }}
              onDeleteNode={(nodeId) => {
                const { newBody, fallbackId } = resolveDeleteFallback(body, headingTree, nodeId);
                handleChange(newBody);
                setMindmapSelectedId(fallbackId);
              }}
            />
          </Suspense>
        </div>
      )}
      {graphEverOpened && (
        <div data-testid="graph-view-wrapper" className="flex-1 min-h-0" style={viewMode !== "graph" ? { display: "none" } : undefined}>
          <Suspense fallback={<div className="flex items-center justify-center h-full text-text-faint">Loading…</div>}>
            <LazyGraphView
              activePageId={currentPagePath}
              initialMode={graphInitialMode}
              visible={viewMode === "graph"}
              onNavigate={(pageId) => {
                selectPage(pageId);
                setViewMode("editor");
              }}
              onExit={() => setViewMode("editor")}
            />
          </Suspense>
        </div>
      )}
      <BottomPanel pageId={currentPagePath} />
      <ConflictDialog
        open={showConflict}
        onKeepMine={() => setShowConflict(false)}
        onReload={() => {
          setShowConflict(false);
          if (currentPagePath) {
            loadPage(currentPagePath);
            setDirty(false);
          }
        }}
      />
    </main>
  );
}
