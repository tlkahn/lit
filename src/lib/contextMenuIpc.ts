import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

export async function showTrashContextMenu(trashName: string): Promise<void> {
  return invoke<void>("show_trash_context_menu", { trashName });
}

interface TrashContextPayload {
  trash_name: string;
}

interface TrashContextMenuHandlers {
  onRestore: (trashName: string) => void;
  onPurge: (trashName: string) => void;
}

export async function showSidebarContextMenu(relativePath: string): Promise<void> {
  return invoke<void>("show_sidebar_context_menu", { relativePath });
}

interface SidebarContextPayload {
  relative_path: string;
}

interface SidebarContextMenuHandlers {
  onRename: (relativePath: string) => void;
  onExternalEditor: (relativePath: string) => void;
  onExportNetwork: (relativePath: string) => void;
  onTrash: (relativePath: string) => void;
}

export function useSidebarContextMenu(handlers: SidebarContextMenuHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<Promise<() => void>> = [];

    unlisteners.push(
      listen<SidebarContextPayload>("context-menu://sidebar/rename", (event) => {
        if (!cancelled) handlersRef.current.onRename(event.payload.relative_path);
      }),
    );

    unlisteners.push(
      listen<SidebarContextPayload>("context-menu://sidebar/external-editor", (event) => {
        if (!cancelled) handlersRef.current.onExternalEditor(event.payload.relative_path);
      }),
    );

    unlisteners.push(
      listen<SidebarContextPayload>("context-menu://sidebar/export-network", (event) => {
        if (!cancelled) handlersRef.current.onExportNetwork(event.payload.relative_path);
      }),
    );

    unlisteners.push(
      listen<SidebarContextPayload>("context-menu://sidebar/trash", (event) => {
        if (!cancelled) handlersRef.current.onTrash(event.payload.relative_path);
      }),
    );

    return () => {
      cancelled = true;
      for (const p of unlisteners) p.then((u) => u());
    };
  }, []);
}

export function useTrashContextMenu(handlers: TrashContextMenuHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<Promise<() => void>> = [];

    unlisteners.push(
      listen<TrashContextPayload>("context-menu://trash/restore", (event) => {
        if (!cancelled) handlersRef.current.onRestore(event.payload.trash_name);
      }),
    );

    unlisteners.push(
      listen<TrashContextPayload>("context-menu://trash/purge", (event) => {
        if (!cancelled) handlersRef.current.onPurge(event.payload.trash_name);
      }),
    );

    return () => {
      cancelled = true;
      for (const p of unlisteners) p.then((u) => u());
    };
  }, []);
}
