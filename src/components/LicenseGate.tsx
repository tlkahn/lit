import { useEffect, useState, type ReactNode } from "react";
import { useLicenseStore } from "../stores/license";
import { TrialBanner } from "./TrialBanner";
import { LicenseEntryDialog } from "./LicenseEntryDialog";
import { SpinnerSvg } from "./SpinnerSvg";
import { openUrl } from "@tauri-apps/plugin-opener";

interface LicenseGateProps {
  children: ReactNode;
}

export function LicenseGate({ children }: LicenseGateProps) {
  const state = useLicenseStore((s) => s.state);
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

  if (state === "expired") {
    return (
      <>
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-bg-primary"
          data-testid="license-expired-overlay"
        >
          <p className="text-lg font-medium text-text-normal">Your 14-day trial has ended</p>
          <p className="max-w-sm text-center text-sm text-text-muted">
            Lit is a one-time purchase of $29.
          </p>
          <div className="flex gap-3">
            <button
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:opacity-90"
              onClick={() => openUrl("https://lit.solar/buy")}
              data-testid="expired-buy-license"
            >
              Buy License
            </button>
            <button
              className="rounded border border-border-primary px-4 py-2 text-sm text-text-normal hover:bg-bg-secondary"
              onClick={() => setEntryOpen(true)}
              data-testid="expired-enter-key"
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
              data-testid="expired-export-data"
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
      <TrialBanner onEnterKey={() => setEntryOpen(true)} />
      {children}
      <LicenseEntryDialog open={entryOpen} onClose={() => setEntryOpen(false)} />
    </>
  );
}
