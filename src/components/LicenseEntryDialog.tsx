import { useState, useEffect, useCallback } from "react";
import { useLicenseStore } from "../stores/license";

interface LicenseEntryDialogProps {
  open: boolean;
  onClose: () => void;
}

export function LicenseEntryDialog({ open, onClose }: LicenseEntryDialogProps) {
  const [key, setKey] = useState("");
  const activate = useLicenseStore((s) => s.activate);
  const error = useLicenseStore((s) => s.error);
  const clearError = useLicenseStore((s) => s.clearError);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  const handleActivate = async () => {
    const ok = await activate(key.trim());
    if (ok) onClose();
  };

  const handleChange = (value: string) => {
    setKey(value);
    clearError();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="license-entry-backdrop"
    >
      <div className="w-96 rounded-lg bg-bg-primary p-5 shadow-lg" data-testid="license-entry-dialog">
        <p className="mb-3 text-sm font-medium text-text-normal">Enter License Key</p>
        <textarea
          className="mb-3 h-32 w-full resize-none rounded border border-border-primary bg-bg-secondary p-2 font-mono text-xs text-text-normal"
          value={key}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Paste your PEM license key here…"
          data-testid="license-entry-input"
        />
        {error && (
          <p className="mb-3 text-xs text-red-500" data-testid="license-entry-error">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
            onClick={onClose}
            data-testid="license-entry-cancel"
          >
            Cancel
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-40"
            onClick={handleActivate}
            disabled={key.trim().length === 0}
            data-testid="license-entry-activate"
          >
            Activate
          </button>
        </div>
      </div>
    </div>
  );
}
