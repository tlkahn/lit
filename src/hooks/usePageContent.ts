import { useState, useRef, useCallback, useEffect } from "react";
import { readPage, acknowledgeFileHash } from "../lib/ipc";
import {
  registerPaneContent,
  unregisterPaneContent,
  updatePaneContent,
} from "../lib/paneContentRegistry";
import {
  acquire,
  release,
  getDoc,
  setContent,
  setBody as sharedSetBody,
  subscribe as sharedSubscribe,
  subscribeSaveSettled,
} from "../lib/sharedDocs";
import { extractHeadings } from "../lib/headings";
import { frontmatterLineCount } from "../lib/pathUtils";
import { useWorkspaceStore } from "../stores/workspace";
import { getCurrentEditorView } from "../lib/editorViewRef";

export interface PageContentState {
  body: string;
  title: string;
  frontmatter: Record<string, unknown>;
  rawYaml: string;
  isDirty: boolean;
  handleChange: (newBody: string) => void;
  siblingUpdateRef: React.RefObject<boolean>;
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

  const headingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPathRef = useRef<string | null>(null);
  const frontmatterRef = useRef<Record<string, unknown>>({});
  const siblingUpdateRef = useRef(false);

  const setCurrentPageHeadings = useWorkspaceStore((s) => s.setCurrentPageHeadings);
  const setCurrentFrontmatterLineCount = useWorkspaceStore((s) => s.setCurrentFrontmatterLineCount);
  const setDirty = useWorkspaceStore((s) => s.setDirty);

  useEffect(() => {
    currentPathRef.current = pagePath;
    if (headingDebounceRef.current) clearTimeout(headingDebounceRef.current);

    if (!pagePath) {
      setBody("");
      setTitle("");
      setFrontmatter({});
      setRawYaml("");
      setIsDirty(false);
      unregisterPaneContent(paneId);
      return;
    }

    acquire(pagePath, paneId);

    const unsubBody = sharedSubscribe(pagePath, paneId, (newBody) => {
      siblingUpdateRef.current = true;
      setBody(newBody);
      updatePaneContent(paneId, { body: newBody });
    });

    const unsubSave = subscribeSaveSettled(pagePath, paneId, (stillDirty) => {
      if (!stillDirty) {
        setIsDirty(false);
        setDirty(false);
      }
    });

    const doc = getDoc(pagePath);
    if (doc && doc.body) {
      setBody(doc.body);
      setTitle(doc.title);
      setFrontmatter(doc.frontmatter);
      setRawYaml(doc.rawYaml);
      setIsDirty(false);
      frontmatterRef.current = doc.frontmatter;
      siblingUpdateRef.current = false;
      registerPaneContent(paneId, {
        title: doc.title,
        body: doc.body,
        frontmatter: doc.frontmatter,
        rawYaml: doc.rawYaml,
      });
      setCurrentPageHeadings(extractHeadings(doc.body));
      setCurrentFrontmatterLineCount(frontmatterLineCount(doc.rawYaml));
    } else {
      readPage(pagePath)
        .then((content) => {
          if (currentPathRef.current !== pagePath) return;
          setBody(content.body);
          setTitle(content.meta.title);
          setFrontmatter(content.meta.frontmatter);
          setRawYaml(content.raw_yaml);
          setIsDirty(false);
          frontmatterRef.current = content.meta.frontmatter;
          siblingUpdateRef.current = false;
          setContent(pagePath, {
            body: content.body,
            title: content.meta.title,
            frontmatter: content.meta.frontmatter,
            rawYaml: content.raw_yaml,
          });
          registerPaneContent(paneId, {
            title: content.meta.title,
            body: content.body,
            frontmatter: content.meta.frontmatter,
            rawYaml: content.raw_yaml,
          });
          setCurrentPageHeadings(extractHeadings(content.body));
          setCurrentFrontmatterLineCount(frontmatterLineCount(content.raw_yaml));
        })
        .catch(() => {
          if (currentPathRef.current !== pagePath) return;
          setBody("");
          setTitle("");
          setFrontmatter({});
          setRawYaml("");
          setIsDirty(false);
        });
    }

    return () => {
      unsubBody();
      unsubSave();
      if (headingDebounceRef.current) clearTimeout(headingDebounceRef.current);
      release(pagePath, paneId);
    };
  }, [pagePath, paneId, setCurrentPageHeadings, setCurrentFrontmatterLineCount, setDirty]);

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
          setContent(pagePath, {
            body: content.body,
            title: content.meta.title,
            frontmatter: content.meta.frontmatter,
            rawYaml: content.raw_yaml,
          });
          registerPaneContent(paneId, {
            title: content.meta.title,
            body: content.body,
            frontmatter: content.meta.frontmatter,
            rawYaml: content.raw_yaml,
          });
          setCurrentPageHeadings(extractHeadings(content.body));
          setCurrentFrontmatterLineCount(frontmatterLineCount(content.raw_yaml));
        })
        .catch(() => {
          if (currentPathRef.current !== pagePath) return;
        });
    }
  }, [reloadTrigger, pagePath, wsIsDirty, paneId, saveViewState, setCurrentPageHeadings, setCurrentFrontmatterLineCount]);

  const handleChange = useCallback((newBody: string) => {
    setBody(newBody);
    setIsDirty(true);
    setDirty(true);
    siblingUpdateRef.current = false;
    updatePaneContent(paneId, { body: newBody });

    const path = currentPathRef.current;
    if (path) {
      sharedSetBody(path, newBody, paneId);
    }

    if (headingDebounceRef.current) clearTimeout(headingDebounceRef.current);
    headingDebounceRef.current = setTimeout(() => {
      setCurrentPageHeadings(extractHeadings(newBody));
    }, 150);
  }, [paneId, setCurrentPageHeadings, setDirty]);

  return { body, title, frontmatter, rawYaml, isDirty, handleChange, siblingUpdateRef };
}
