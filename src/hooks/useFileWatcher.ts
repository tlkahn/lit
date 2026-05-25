import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../stores/workspace";
import { usePaneStore } from "../stores/panes";
import { useModalLockStore } from "../stores/modalLock";
import type { FileEvent } from "../lib/ipc";

export function useFileWatcher(onCurrentPageModified?: () => void) {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const refreshPages = useWorkspaceStore((s) => s.refreshPages);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const pendingReloadRef = useRef(false);

  useEffect(() => {
    const unsub = useModalLockStore.subscribe((s) => {
      if (!s.locked && pendingReloadRef.current) {
        pendingReloadRef.current = false;
        onCurrentPageModified?.();
      }
    });
    return unsub;
  }, [onCurrentPageModified]);

  useEffect(() => {
    if (!workspacePath) return;

    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      const unModified = await listen<FileEvent>(
        "workspace://file-modified",
        (event) => {
          if (cancelled) return;
          console.debug("[FileWatcher] file-modified:", event.payload.path);
          const currentPage = useWorkspaceStore.getState().currentPagePath;
          if (currentPage && event.payload.path === currentPage) {
            if (useModalLockStore.getState().locked) {
              pendingReloadRef.current = true;
            } else {
              onCurrentPageModified?.();
            }
          }
        },
      );
      if (cancelled) { unModified(); return; }
      unlisteners.push(unModified);

      const unDeleted = await listen<FileEvent>(
        "workspace://file-deleted",
        (event) => {
          if (cancelled) return;
          console.debug("[FileWatcher] file-deleted:", event.payload.path, "current:", useWorkspaceStore.getState().currentPagePath);
          if (useWorkspaceStore.getState().currentPagePath === event.payload.path) {
            console.warn("[FileWatcher] current page deleted, deselecting:", event.payload.path);
            selectPage(null);
          }
          usePaneStore.getState().clearPageFromPanes(event.payload.path);
          refreshPages();
        },
      );
      if (cancelled) { unDeleted(); return; }
      unlisteners.push(unDeleted);

      const unCreated = await listen<FileEvent>(
        "workspace://file-created",
        (event) => {
          if (cancelled) return;
          console.debug("[FileWatcher] file-created:", event.payload.path);
          refreshPages();
        },
      );
      if (cancelled) { unCreated(); return; }
      unlisteners.push(unCreated);
    };

    setup();

    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [workspacePath, refreshPages, selectPage, onCurrentPageModified]);
}
