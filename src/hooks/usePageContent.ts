import { useState, useRef, useCallback, useEffect } from "react";
import { readPage, writePage } from "../lib/ipc";
import {
  registerPaneContent,
  unregisterPaneContent,
} from "../lib/paneContentRegistry";

export interface PageContentState {
  body: string;
  title: string;
  frontmatter: Record<string, unknown>;
  rawYaml: string;
  isDirty: boolean;
  handleChange: (newBody: string) => void;
}

export function usePageContent(
  paneId: string,
  pagePath: string | null,
): PageContentState {
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
  const [rawYaml, setRawYaml] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editGenRef = useRef(0);
  const currentPathRef = useRef<string | null>(null);
  const frontmatterRef = useRef<Record<string, unknown>>({});

  useEffect(() => {
    currentPathRef.current = pagePath;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    editGenRef.current = 0;

    if (!pagePath) {
      setBody("");
      setTitle("");
      setFrontmatter({});
      setRawYaml("");
      setIsDirty(false);
      unregisterPaneContent(paneId);
      return;
    }

    readPage(pagePath)
      .then((content) => {
        if (currentPathRef.current !== pagePath) return;
        setBody(content.body);
        setTitle(content.meta.title);
        setFrontmatter(content.meta.frontmatter);
        setRawYaml(content.raw_yaml);
        setIsDirty(false);
        frontmatterRef.current = content.meta.frontmatter;
        registerPaneContent(paneId, {
          title: content.meta.title,
          frontmatter: content.meta.frontmatter,
          rawYaml: content.raw_yaml,
        });
      })
      .catch(() => {
        setBody("");
        setTitle("");
        setFrontmatter({});
        setRawYaml("");
        setIsDirty(false);
      });

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [pagePath, paneId]);

  useEffect(() => {
    return () => unregisterPaneContent(paneId);
  }, [paneId]);

  const handleChange = useCallback((newBody: string) => {
    setBody(newBody);
    setIsDirty(true);
    const gen = ++editGenRef.current;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const path = currentPathRef.current;
      if (!path) return;
      writePage(path, newBody, frontmatterRef.current)
        .then(() => {
          if (editGenRef.current === gen) setIsDirty(false);
        })
        .catch(console.error);
    }, 300);
  }, []);

  return { body, title, frontmatter, rawYaml, isDirty, handleChange };
}
