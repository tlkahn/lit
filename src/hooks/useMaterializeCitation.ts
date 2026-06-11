import { useCallback, useRef } from "react";
import { materializeCitation } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";

interface UseMaterializeCitationOptions {
  recordDeparture: () => void;
  selectPage: (relativePath: string) => void;
  onError: (msg: string) => void;
  onMaterialized?: () => void;
  onNavigate?: (pageId: string) => void;
}

export function useMaterializeCitation({
  recordDeparture,
  selectPage,
  onError,
  onMaterialized,
  onNavigate,
}: UseMaterializeCitationOptions) {
  const materializingRef = useRef(false);

  return useCallback(
    async (bibKey: string) => {
      if (materializingRef.current) return;
      materializingRef.current = true;
      try {
        const meta = await materializeCitation(bibKey);
        useWorkspaceStore.setState((state) => {
          const exists = state.pages.some(
            (p) => p.relative_path === meta.relative_path,
          );
          return {
            pages: exists ? state.pages : [...state.pages, meta],
          };
        });
        onMaterialized?.();
        recordDeparture();
        if (onNavigate) {
          onNavigate(meta.relative_path);
        } else {
          selectPage(meta.relative_path);
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        materializingRef.current = false;
      }
    },
    [recordDeparture, selectPage, onError, onMaterialized, onNavigate],
  );
}
