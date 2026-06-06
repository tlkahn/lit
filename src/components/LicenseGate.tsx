import { useEffect, useState, type ReactNode } from "react";
import { useLicenseStore } from "../stores/license";
import { LicenseEntryDialog } from "./LicenseEntryDialog";
import { SpinnerSvg } from "./SpinnerSvg";
import { openUrl } from "@tauri-apps/plugin-opener";

interface LicenseGateProps {
  children: ReactNode;
}

export function LicenseGate({ children }: LicenseGateProps) {
  const state = useLicenseStore((s) => s.state);
  const licensedTo = useLicenseStore((s) => s.licensedTo);
  const expiryDate = useLicenseStore((s) => s.expiryDate);
  const loading = useLicenseStore((s) => s.loading);
  const fetchStatus = useLicenseStore((s) => s.fetchStatus);
  const [entryOpen, setEntryOpen] = useState(false);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  if (state === "unknown" && loading) {
    return (
      <div data-testid="license-loading" className="flex h-screen items-center justify-center text-text-muted">
        <SpinnerSvg className="h-6 w-6 text-text-faint" />
      </div>
    );
  }

  if (state === "unlicensed" || state === "license_expired") {
    const expired = state === "license_expired";
    const greeting = licensedTo ? `${licensedTo}, your` : "Your";
    const headline = expired
      ? expiryDate
        ? `${greeting} license expired on ${expiryDate}.`
        : `${greeting} license has expired.`
      : "Lit requires a license to continue.";

    return (
      <>
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-bg-primary"
          data-testid="license-splash"
        >
          <p className="text-lg font-medium text-text-normal">{headline}</p>
          <p className="max-w-sm text-center text-sm text-text-muted">
            Lit is a one-time purchase. Buy a license or enter your existing key to continue.
          </p>
          <div className="flex gap-3">
            <button
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:opacity-90"
              onClick={() => openUrl("https://lit.solar/buy")}
              data-testid="splash-buy-license"
            >
              Buy License
            </button>
            <button
              className="rounded border border-border-primary px-4 py-2 text-sm text-text-normal hover:bg-bg-secondary"
              onClick={() => setEntryOpen(true)}
              data-testid="splash-enter-key"
            >
              Enter License Key
            </button>
            <button
              className="rounded border border-border-primary px-4 py-2 text-sm text-text-normal hover:bg-bg-secondary"
              onClick={async () => {
                const { save } = await import("@tauri-apps/plugin-dialog");
                const dest = await save({ defaultPath: "export.zip", filters: [{ name: "ZIP", extensions: ["zip"] }] });
                if (dest) {
                  const { exportData } = await import("../lib/ipc");
                  await exportData(dest);
                }
              }}
              data-testid="splash-export-data"
            >
              Export My Data
            </button>
          </div>
        </div>
        <LicenseEntryDialog open={entryOpen} onClose={() => setEntryOpen(false)} />
      </>
    );
  }

  return (
    <>
      {children}
      <LicenseEntryDialog open={entryOpen} onClose={() => setEntryOpen(false)} />
    </>
  );
}
