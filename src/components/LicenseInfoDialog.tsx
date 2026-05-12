import { useEffect, useCallback } from "react";
import type { LicenseState } from "../stores/license";

interface LicenseInfoDialogProps {
  open: boolean;
  licenseState: LicenseState;
  licensedTo: string | null;
  daysRemaining: number | null;
  onClose: () => void;
}

function formatLicenseText(licenseState: LicenseState, licensedTo: string | null, daysRemaining: number | null): string {
  if (licenseState === "licensed") {
    return licensedTo ? `Licensed to ${licensedTo}` : "Licensed";
  }
  if (licenseState === "trial" || licenseState === "expiring_soon") {
    const days = daysRemaining ?? 0;
    return `Trial — ${days} day${days === 1 ? "" : "s"} remaining`;
  }
  if (licenseState === "expired") {
    return "Trial expired";
  }
  return "Unknown license status";
}

export function LicenseInfoDialog({ open, licenseState, licensedTo, daysRemaining, onClose }: LicenseInfoDialogProps) {
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
          {formatLicenseText(licenseState, licensedTo, daysRemaining)}
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
