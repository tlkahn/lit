import { useCallback, useRef } from "react";
import { materializeAndOpen } from "../lib/materializeAndOpen";

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
        await materializeAndOpen(bibKey, { recordDeparture, navigate });
        onMaterialized?.();
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        materializingRef.current = false;
      }
    },
    [recordDeparture, navigate, onError, onMaterialized],
  );
}
