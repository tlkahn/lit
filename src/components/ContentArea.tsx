import { useEffect, useState, useRef, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../stores/workspace";
import { readPage, writePage } from "../lib/ipc";
import { CodeMirrorEditor } from "../editor/CodeMirrorEditor";
import type { Theme } from "../hooks/useTheme";

interface ContentAreaProps {
  theme: Theme;
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

export function ContentArea({ theme }: ContentAreaProps) {
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
        className="flex flex-1 items-center justify-center bg-white dark:bg-neutral-800"
        data-testid="empty-state"
      >
        <p className="text-neutral-400 dark:text-neutral-500">
          Select a page to start editing
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-white dark:bg-neutral-800">
      <div className="border-b border-neutral-200 px-6 py-3 dark:border-neutral-700">
        <h1
          className="text-lg font-semibold text-neutral-800 dark:text-neutral-100"
          data-testid="page-title"
        >
          {title}
        </h1>
        {Object.keys(frontmatter).length > 0 && (
          <button
            onClick={() => setShowFrontmatter(!showFrontmatter)}
            className="mt-1 text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            {showFrontmatter ? "Hide" : "Show"} frontmatter
          </button>
        )}
        {showFrontmatter && (
          <pre
            className="mt-2 rounded bg-neutral-100 p-2 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
            data-testid="frontmatter"
          >
            {JSON.stringify(frontmatter, null, 2)}
          </pre>
        )}
      </div>
      <CodeMirrorEditor doc={body} theme={theme} onChange={handleChange} resolveImageSrc={resolveImageSrc} />
    </main>
  );
}
