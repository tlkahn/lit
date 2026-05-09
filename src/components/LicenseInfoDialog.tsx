import { useEffect, useCallback } from "react";

interface LicenseInfoDialogProps {
  open: boolean;
  licensedTo: string | null;
  onClose: () => void;
}

export function LicenseInfoDialog({ open, licensedTo, onClose }: LicenseInfoDialogProps) {
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="license-info-backdrop"
    >
      <div className="w-80 rounded-lg bg-bg-primary p-5 shadow-lg" data-testid="license-info-dialog">
        <p className="mb-4 text-sm text-text-normal">
          {licensedTo ? `Licensed to ${licensedTo}` : "Licensed"}
        </p>
        <div className="flex justify-end">
          <button
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
            onClick={onClose}
            data-testid="license-info-close"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
