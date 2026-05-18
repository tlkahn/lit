import { useState, useRef, useCallback, useEffect } from "react";
import { readPage, writePage, acknowledgeFileHash } from "../lib/ipc";
import {
  registerPaneContent,
  unregisterPaneContent,
  updatePaneContent,
} from "../lib/paneContentRegistry";
import { extractHeadings } from "../lib/headings";
import { useWorkspaceStore } from "../stores/workspace";
import { getCurrentEditorView } from "../lib/editorViewRef";

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
  const headingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editGenRef = useRef(0);
  const currentPathRef = useRef<string | null>(null);
  const frontmatterRef = useRef<Record<string, unknown>>({});

  const setCurrentPageHeadings = useWorkspaceStore((s) => s.setCurrentPageHeadings);
  const setCurrentFrontmatterLineCount = useWorkspaceStore((s) => s.setCurrentFrontmatterLineCount);

  useEffect(() => {
    currentPathRef.current = pagePath;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (headingDebounceRef.current) clearTimeout(headingDebounceRef.current);
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
          body: content.body,
          frontmatter: content.meta.frontmatter,
          rawYaml: content.raw_yaml,
        });
        setCurrentPageHeadings(extractHeadings(content.body));
        const fmLineCount = content.raw_yaml
          ? content.raw_yaml.trimEnd().split("\n").length + 2
          : 0;
        setCurrentFrontmatterLineCount(fmLineCount);
      })
      .catch(() => {
        if (currentPathRef.current !== pagePath) return;
        setBody("");
        setTitle("");
        setFrontmatter({});
        setRawYaml("");
        setIsDirty(false);
      });

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (headingDebounceRef.current) clearTimeout(headingDebounceRef.current);
    };
  }, [pagePath, paneId, setCurrentPageHeadings, setCurrentFrontmatterLineCount]);

  useEffect(() => {
    return () => unregisterPaneContent(paneId);
  }, [paneId]);

  const reloadTrigger = useWorkspaceStore((s) => s.reloadTrigger);
  const wsIsDirty = useWorkspaceStore((s) => s.isDirty);
  const saveViewState = useWorkspaceStore((s) => s.saveViewState);

  useEffect(() => {
    if (reloadTrigger === 0 || !pagePath) return;
    if (wsIsDirty) {
      acknowledgeFileHash(pagePath);
    } else {
      const view = getCurrentEditorView();
      if (view) {
        saveViewState(pagePath, view.scrollDOM.scrollTop, view.state.selection.main.head);
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
            body: content.body,
            frontmatter: content.meta.frontmatter,
            rawYaml: content.raw_yaml,
          });
          setCurrentPageHeadings(extractHeadings(content.body));
        })
        .catch(() => {
          if (currentPathRef.current !== pagePath) return;
        });
    }
  }, [reloadTrigger, pagePath, wsIsDirty, paneId, saveViewState, setCurrentPageHeadings]);

  const handleChange = useCallback((newBody: string) => {
    setBody(newBody);
    setIsDirty(true);
    updatePaneContent(paneId, { body: newBody });
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
    if (headingDebounceRef.current) clearTimeout(headingDebounceRef.current);
    headingDebounceRef.current = setTimeout(() => {
      setCurrentPageHeadings(extractHeadings(newBody));
    }, 150);
  }, [paneId, setCurrentPageHeadings]);

  return { body, title, frontmatter, rawYaml, isDirty, handleChange };
}
