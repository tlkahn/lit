import { useEffect, useState, useRef, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../stores/workspace";
import { readPage, writePage, parseRawYaml } from "../lib/ipc";
import { CodeMirrorEditor } from "../editor/CodeMirrorEditor";
import { YamlHighlighter } from "./YamlHighlighter";

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
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
  const [rawYaml, setRawYaml] = useState("");
  const [showFrontmatter, setShowFrontmatter] = useState(false);
  const [editingYaml, setEditingYaml] = useState(false);
  const [yamlDraft, setYamlDraft] = useState("");
  const [yamlError, setYamlError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    }
  }, []);

  useEffect(() => {
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
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [currentPagePath, loadPage]);

  useEffect(() => {
    if (pendingTitleFocus && title) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
      clearPendingTitleFocus();
    }
  }, [pendingTitleFocus, title, clearPendingTitleFocus]);

  const resolveImageSrc = useCallback((src: string): string => {
    if (/^(https?:|data:|blob:)/.test(src)) return src;
    if (!workspacePath || !currentPagePath) return src;

    const lastSlash = currentPagePath.lastIndexOf("/");
    const fileDir = lastSlash >= 0 ? currentPagePath.substring(0, lastSlash) : "";
    const absolutePath = workspacePath + "/" + resolveRelativePath(fileDir, src);
    return convertFileSrc(absolutePath);
  }, [workspacePath, currentPagePath]);

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
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (currentPagePath) {
        writePage(currentPagePath, newBody, frontmatter).catch((err) => {
          console.error("[ContentArea] writePage failed:", err);
        });
      }
    }, 300);
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
        <input
          ref={titleInputRef}
          className="w-full bg-transparent text-lg font-semibold text-text-normal outline-none"
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
            className="mt-1 text-xs text-text-faint hover:text-text-muted"
          >
            {showFrontmatter ? "Hide" : "Show"} frontmatter
          </button>
        )}
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
      <CodeMirrorEditor doc={body} onChange={handleChange} resolveImageSrc={resolveImageSrc} />
    </main>
  );
}
