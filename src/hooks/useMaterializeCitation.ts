import { useCallback, useRef } from "react";
import { materializeCitation } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";

interface UseMaterializeCitationOptions {
  recordDeparture: () => void;
  navigate: (relativePath: string) => void;
  onError: (msg: string) => void;
  onMaterialized?: () => void;
}

export function useMaterializeCitation({
  recordDeparture,
  navigate,
  onError,
  onMaterialized,
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
            pages: exists
              ? state.pages.map((p) =>
                  p.relative_path === meta.relative_path ? meta : p,
                )
              : [...state.pages, meta],
          };
        });
        onMaterialized?.();
        recordDeparture();
        navigate(meta.relative_path);
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        materializingRef.current = false;
      }
    },
    [recordDeparture, navigate, onError, onMaterialized],
  );
}
