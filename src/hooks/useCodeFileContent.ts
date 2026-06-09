import { useState, useRef, useCallback, useEffect } from "react";
import { readCodeFile, acknowledgeFileHash } from "../lib/ipc";
import {
  acquire,
  release,
  getDoc,
  setContent,
  setBody as sharedSetBody,
  subscribe as sharedSubscribe,
  subscribeSaveSettled,
  subscribeContentReload,
  startReload,
  finishReload,
  cancelReload,
} from "../lib/sharedCodeDocs";
import { useWorkspaceStore } from "../stores/workspace";
import { getCurrentEditorView } from "../lib/editorViewRef";

export interface CodeFileContentState {
  body: string;
  isDirty: boolean;
  handleChange: (newBody: string) => void;
  siblingUpdateRef: React.RefObject<boolean>;
}

/**
 * Content hook for code files. Mirrors usePageContent but bypasses all markdown
 * machinery: no heading extraction, no frontmatter line counting, no
 * paneContentRegistry (which feeds the markdown outline/backlinks), and reads
 * and saves via readCodeFile/sharedCodeDocs (raw text, no frontmatter).
 */
export function useCodeFileContent(
  paneId: string,
  pagePath: string | null,
): CodeFileContentState {
  const [body, setBody] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const currentPathRef = useRef<string | null>(null);
  const siblingUpdateRef = useRef(false);

  const setDirty = useWorkspaceStore((s) => s.setDirty);

  useEffect(() => {
    currentPathRef.current = pagePath;

    if (!pagePath) {
      setBody("");
      setIsDirty(false);
      return;
    }

    acquire(pagePath, paneId);

    const unsubBody = sharedSubscribe(pagePath, paneId, (newBody) => {
      siblingUpdateRef.current = true;
      setBody(newBody);
    });

    const unsubSave = subscribeSaveSettled(pagePath, paneId, (stillDirty) => {
      if (!stillDirty) {
        setIsDirty(false);
        setDirty(false);
      }
    });

    const unsubContentReload = subscribeContentReload(pagePath, paneId, (content) => {
      setBody(content.body);
      setIsDirty(false);
    });

    const doc = getDoc(pagePath);
    if (doc && doc.loaded) {
      setBody(doc.body);
      setIsDirty(false);
      siblingUpdateRef.current = false;
    } else {
      readCodeFile(pagePath)
        .then((content) => {
          if (currentPathRef.current !== pagePath) return;
          setBody(content.body);
          setIsDirty(false);
          siblingUpdateRef.current = false;
          setContent(pagePath, { body: content.body, title: content.title });
        })
        .catch(() => {
          if (currentPathRef.current !== pagePath) return;
          setBody("");
          setIsDirty(false);
        });
    }

    return () => {
      unsubBody();
      unsubSave();
      unsubContentReload();
      release(pagePath, paneId);
    };
  }, [pagePath, paneId, setDirty]);

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
      readCodeFile(pagePath)
        .then((content) => {
          if (currentPathRef.current !== pagePath) {
            cancelReload(pagePath);
            return;
          }
          setBody(content.body);
          setIsDirty(false);
          finishReload(pagePath, { body: content.body, title: content.title }, paneId);
        })
        .catch(() => {
          cancelReload(pagePath);
        });
    }
  }, [reloadTrigger, pagePath, wsIsDirty, paneId, saveViewState]);

  const handleChange = useCallback(
    (newBody: string) => {
      setBody(newBody);
      setIsDirty(true);
      setDirty(true);
      siblingUpdateRef.current = false;

      const path = currentPathRef.current;
      if (path) {
        sharedSetBody(path, newBody, paneId);
      }
    },
    [paneId, setDirty],
  );

  return { body, isDirty, handleChange, siblingUpdateRef };
}
