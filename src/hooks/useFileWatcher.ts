import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../stores/workspace";
import type { FileEvent } from "../lib/ipc";

export function useFileWatcher(onCurrentPageModified?: () => void) {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const refreshPages = useWorkspaceStore((s) => s.refreshPages);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const currentPageRef = useRef(currentPagePath);

  useEffect(() => {
    currentPageRef.current = currentPagePath;
  }, [currentPagePath]);

  useEffect(() => {
    if (!workspacePath) return;

    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      const unModified = await listen<FileEvent>(
        "workspace://file-modified",
        (event) => {
          if (
            currentPageRef.current &&
            event.payload.path === currentPageRef.current
          ) {
            onCurrentPageModified?.();
          }
        },
      );
      unlisteners.push(unModified);

      const unDeleted = await listen<FileEvent>(
        "workspace://file-deleted",
        (event) => {
          if (currentPageRef.current === event.payload.path) {
            selectPage(null);
          }
          refreshPages();
        },
      );
      unlisteners.push(unDeleted);

      const unCreated = await listen<FileEvent>(
        "workspace://file-created",
        () => {
          refreshPages();
        },
      );
      unlisteners.push(unCreated);
    };

    setup();

    return () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [workspacePath, refreshPages, selectPage, onCurrentPageModified]);
}
