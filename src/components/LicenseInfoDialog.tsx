import { useEffect, useCallback } from "react";
import type { LicenseState } from "../stores/license";

interface LicenseInfoDialogProps {
  open: boolean;
  licenseState: LicenseState;
  licensedTo: string | null;
  onClose: () => void;
}

function formatLicenseText(licenseState: LicenseState, licensedTo: string | null): string {
  if (licenseState === "licensed") {
    return licensedTo ? `Licensed to ${licensedTo}` : "Licensed";
  }
  if (licenseState === "license_expired") {
    return "License expired";
  }
  return "No license";
}

export function LicenseInfoDialog({ open, licenseState, licensedTo, onClose }: LicenseInfoDialogProps) {
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
          {formatLicenseText(licenseState, licensedTo)}
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
