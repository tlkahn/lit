import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../stores/workspace";
import { readPage, writePage, parseRawYaml, openInExternalEditor } from "../lib/ipc";
import { setCurrentEditorView } from "../lib/editorViewRef";
import { extractHeadings } from "../lib/headings";
import { CodeMirrorEditor } from "../editor/CodeMirrorEditor";
import { ConflictDialog } from "./ConflictDialog";
import { YamlHighlighter } from "./YamlHighlighter";
import { useKeymaps } from "../hooks/useKeymaps";
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
  const { editorBindings } = useKeymaps();
  const editorViewRef = useRef<EditorView | null>(null);
  const [body, setBody] = useState("");
  const [showConflict, setShowConflict] = useState(false);
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
  const editGenRef = useRef(0);
  const currentPathRef = useRef<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelledRef = useRef(false);

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
      setCurrentPageHeadings([]);
    }
  }, [setCurrentPageHeadings]);

  useEffect(() => {
    const previousPath = currentPathRef.current;
    if (previousPath && editorViewRef.current) {
      const view = editorViewRef.current;
      saveViewState(previousPath, view.scrollDOM.scrollTop, view.state.selection.main.head);
    }
    currentPathRef.current = currentPagePath;
    if (currentPagePath) {
      loadPage(currentPagePath);
    } else {
      setBody("");
      setTitle("");
      setEditingTitle("");
      setFrontmatter({});
      setRawYaml("");
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
        const lineNum = Math.min(storeState.pendingCursorLine, view.state.doc.lines);
        const line = view.state.doc.line(lineNum);
        view.dispatch({
          selection: EditorSelection.cursor(line.from),
          effects: EditorView.scrollIntoView(line.from, { y: "start" }),
        });
        useWorkspaceStore.setState({ pendingCursorLine: null });
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
      setCurrentPageHeadings(extractHeadings(newBody));
    }, 150);
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
    let unlisten: (() => void) | undefined;
    listen("menu://open-in-external-editor", () => {
      const view = editorViewRef.current;
      const path = useWorkspaceStore.getState().currentPagePath;
      if (!view || !path) return;
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      openInExternalEditor(path, line.number, pos - line.from + 1);
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
      <CodeMirrorEditor doc={body} onChange={handleChange} resolveImageSrc={resolveImageSrc} viewRef={editorViewRef} onDocReplaced={handleDocReplaced} keymapBindings={editorBindings} frontmatter={frontmatter} noteDir={noteDir} />
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
