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
