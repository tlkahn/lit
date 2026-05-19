import { useState, useRef, useCallback } from "react";
import { exportSubgraph } from "../lib/ipc";

export function useSubgraphExport() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const nodeIdRef = useRef<string | null>(null);

  const requestExport = useCallback((nodeId: string) => {
    nodeIdRef.current = nodeId;
    setPickerOpen(true);
  }, []);

  const handlePickerCancel = useCallback(() => setPickerOpen(false), []);

  const handlePickerExport = useCallback(async (depth: number) => {
    setPickerOpen(false);
    const { save } = await import("@tauri-apps/plugin-dialog");
    const dest = await save({
      defaultPath: "export.zip",
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (dest && nodeIdRef.current) {
      await exportSubgraph(nodeIdRef.current, depth, dest);
    }
  }, []);

  return { pickerOpen, requestExport, handlePickerExport, handlePickerCancel };
}
