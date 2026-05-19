import { useState, useEffect, useCallback } from "react";
import { SegmentedControl } from "./SegmentedControl";

interface SubgraphExportPickerProps {
  open: boolean;
  onExport: (depth: number) => void;
  onCancel: () => void;
}

const depthOptions = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
];

export function SubgraphExportPicker({ open, onExport, onCancel }: SubgraphExportPickerProps) {
  const [depth, setDepth] = useState("1");

  useEffect(() => {
    if (open) setDepth("1");
  }, [open]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    },
    [onCancel],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="subgraph-export-picker"
    >
      <div className="w-72 rounded-lg bg-bg-primary p-5 shadow-lg">
        <SegmentedControl
          options={depthOptions}
          value={depth}
          onChange={setDepth}
          testId="export-depth"
          label="Depth"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded bg-interactive-accent px-3 py-1.5 text-sm text-text-on-accent hover:opacity-90"
            onClick={() => onExport(Number(depth))}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
