import { useEffect, useState, useRef, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../stores/workspace";
import { readPage, writePage } from "../lib/ipc";
import { CodeMirrorEditor } from "../editor/CodeMirrorEditor";

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
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
  const [showFrontmatter, setShowFrontmatter] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPathRef = useRef<string | null>(null);

  const loadPage = useCallback(async (path: string) => {
    try {
      const content = await readPage(path);
      if (currentPathRef.current === path) {
        console.debug("[ContentArea] loadPage OK:", path, "body length:", content.body.length);
        setBody(content.body);
        setTitle(content.meta.title);
        setFrontmatter(content.meta.frontmatter);
      } else {
        console.debug("[ContentArea] loadPage stale, ignoring:", path);
      }
    } catch (err) {
      console.error("[ContentArea] loadPage failed:", path, err);
      setBody("");
      setTitle("");
      setFrontmatter({});
    }
  }, []);

  useEffect(() => {
    currentPathRef.current = currentPagePath;
    if (currentPagePath) {
      loadPage(currentPagePath);
    } else {
      setBody("");
      setTitle("");
      setFrontmatter({});
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [currentPagePath, loadPage]);

  const resolveImageSrc = useCallback((src: string): string => {
    if (/^(https?:|data:|blob:)/.test(src)) return src;
    if (!workspacePath || !currentPagePath) return src;

    const lastSlash = currentPagePath.lastIndexOf("/");
    const fileDir = lastSlash >= 0 ? currentPagePath.substring(0, lastSlash) : "";
    const absolutePath = workspacePath + "/" + resolveRelativePath(fileDir, src);
    return convertFileSrc(absolutePath);
  }, [workspacePath, currentPagePath]);

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
      <div className="border-b border-border px-6 py-3">
        <h1
          className="text-lg font-semibold text-text-normal"
          data-testid="page-title"
        >
          {title}
        </h1>
        {Object.keys(frontmatter).length > 0 && (
          <button
            onClick={() => setShowFrontmatter(!showFrontmatter)}
            className="mt-1 text-xs text-text-faint hover:text-text-muted"
          >
            {showFrontmatter ? "Hide" : "Show"} frontmatter
          </button>
        )}
        {showFrontmatter && (
          <pre
            className="mt-2 rounded bg-bg-secondary p-2 text-xs text-text-muted"
            data-testid="frontmatter"
          >
            {JSON.stringify(frontmatter, null, 2)}
          </pre>
        )}
      </div>
      <CodeMirrorEditor doc={body} onChange={handleChange} resolveImageSrc={resolveImageSrc} />
    </main>
  );
}
