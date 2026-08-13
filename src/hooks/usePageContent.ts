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
  isDirty as sharedIsDirty,
  subscribe as sharedSubscribe,
  subscribeSaveSettled,
  subscribeContentReload,
  startReload,
  finishReload,
  cancelReload,
} from "../lib/sharedDocs";
import { extractHeadings } from "../lib/headings";
import { frontmatterLineCount } from "../lib/pathUtils";
import { onFrontmatterPatch } from "../lib/frontmatterBus";
import { useWorkspaceStore } from "../stores/workspace";
import { usePaneStore } from "../stores/panes";
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
  const siblingUpdateRef = useRef(false);

  const setCurrentPageHeadings = useWorkspaceStore((s) => s.setCurrentPageHeadings);
  const setCurrentFrontmatterLineCount = useWorkspaceStore((s) => s.setCurrentFrontmatterLineCount);
  const setDirty = useWorkspaceStore((s) => s.setDirty);

  const isFocused = () => usePaneStore.getState().focusedPaneId === paneId;

  const syncHeadings = (bodyText: string, yaml: string) => {
    if (!isFocused()) return;
    setCurrentPageHeadings(extractHeadings(bodyText));
    setCurrentFrontmatterLineCount(frontmatterLineCount(yaml));
  };

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

    const unsubContentReload = subscribeContentReload(pagePath, paneId, (content) => {
      setBody(content.body);
      setTitle(content.title);
      setFrontmatter(content.frontmatter);
      setRawYaml(content.rawYaml);
      setIsDirty(false);
      registerPaneContent(paneId, {
        title: content.title,
        body: content.body,
        frontmatter: content.frontmatter,
        rawYaml: content.rawYaml,
      });
      syncHeadings(content.body, content.rawYaml);
    });

    const unsubFmBus = onFrontmatterPatch(pagePath, (_path, patch) => {
      // Compute updated frontmatter from the shared doc (source of truth)
      const fmDoc = getDoc(pagePath);
      const currentFm = fmDoc?.frontmatter ?? {};
      const updatedFm = { ...currentFm, ...patch };

      // Update React state
      setFrontmatter(updatedFm);
      setIsDirty(true);
      setDirty(true);

      // Update shared doc + schedule save
      if (fmDoc) {
        fmDoc.frontmatter = updatedFm;
        // Append new fields to rawYaml for line-count accuracy
        let updatedRawYaml = fmDoc.rawYaml || "";
        for (const [key, value] of Object.entries(patch)) {
          if (!updatedRawYaml.includes(`${key}:`)) {
            const yamlVal = typeof value === "string" ? `'${value}'` : String(value);
            updatedRawYaml = updatedRawYaml.trimEnd() + `\n${key}: ${yamlVal}\n`;
          }
        }
        fmDoc.rawYaml = updatedRawYaml;
        setRawYaml(updatedRawYaml);
        sharedSetBody(pagePath, fmDoc.body, paneId);
      }

      updatePaneContent(paneId, { frontmatter: updatedFm });
    });

    const doc = getDoc(pagePath);
    if (doc && doc.loaded) {
      setBody(doc.body);
      setTitle(doc.title);
      setFrontmatter(doc.frontmatter);
      setRawYaml(doc.rawYaml);
      // Re-acquiring a moved (renamed) doc must not lie about dirty: after
      // renamePath the doc's editGen/saveGen survive, so consult the registry
      // instead of hardcoding false. Navigation onto a fresh doc still lands
      // in the else branch and starts clean.
      const dirty = sharedIsDirty(pagePath);
      setIsDirty(dirty);
      if (isFocused()) setDirty(dirty);
      siblingUpdateRef.current = false;
      registerPaneContent(paneId, {
        title: doc.title,
        body: doc.body,
        frontmatter: doc.frontmatter,
        rawYaml: doc.rawYaml,
      });
      syncHeadings(doc.body, doc.rawYaml);
    } else {
      readPage(pagePath)
        .then((content) => {
          if (currentPathRef.current !== pagePath) return;
          setBody(content.body);
          setTitle(content.meta.title);
          setFrontmatter(content.meta.frontmatter);
          setRawYaml(content.raw_yaml);
          setIsDirty(false);
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
          syncHeadings(content.body, content.raw_yaml);
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
      unsubContentReload();
      unsubFmBus();
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
      if (!startReload(pagePath)) return;
      const view = getCurrentEditorView();
      if (view) {
        saveViewState(pagePath, view.scrollDOM.scrollTop, view.state.selection.main.head);
      }
      readPage(pagePath)
        .then((content) => {
          if (currentPathRef.current !== pagePath) {
            cancelReload(pagePath);
            return;
          }
          setBody(content.body);
          setTitle(content.meta.title);
          setFrontmatter(content.meta.frontmatter);
          setRawYaml(content.raw_yaml);
          setIsDirty(false);
          finishReload(pagePath, {
            body: content.body,
            title: content.meta.title,
            frontmatter: content.meta.frontmatter,
            rawYaml: content.raw_yaml,
          }, paneId);
          registerPaneContent(paneId, {
            title: content.meta.title,
            body: content.body,
            frontmatter: content.meta.frontmatter,
            rawYaml: content.raw_yaml,
          });
          syncHeadings(content.body, content.raw_yaml);
        })
        .catch(() => {
          cancelReload(pagePath);
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
      if (!isFocused()) return;
      setCurrentPageHeadings(extractHeadings(newBody));
    }, 150);
  }, [paneId, setCurrentPageHeadings, setDirty]);

  return { body, title, frontmatter, rawYaml, isDirty, handleChange, siblingUpdateRef };
}
