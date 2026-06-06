import { useEffect, useState, type ReactNode } from "react";
import { useLicenseStore } from "../stores/license";
import { LicenseEntryDialog } from "./LicenseEntryDialog";
import { SpinnerSvg } from "./SpinnerSvg";
import { getCachedBuildInfo } from "../lib/ipc";
import { openUrl } from "@tauri-apps/plugin-opener";

interface LicenseGateProps {
  children: ReactNode;
  /**
   * Controlled open-state for the license-entry dialog. When provided, App
   * owns this state so the menu (menu://enter-license-key) can open the dialog
   * regardless of gate state. When omitted, the gate falls back to its own
   * internal state so the standalone component stays self-contained.
   */
  entryOpen?: boolean;
  onEntryOpenChange?: (open: boolean) => void;
}

export function LicenseGate({ children, entryOpen, onEntryOpenChange }: LicenseGateProps) {
  const state = useLicenseStore((s) => s.state);
  const licensedTo = useLicenseStore((s) => s.licensedTo);
  const expiryDate = useLicenseStore((s) => s.expiryDate);
  const reason = useLicenseStore((s) => s.reason);
  const fetchStatus = useLicenseStore((s) => s.fetchStatus);
  const [internalEntryOpen, setInternalEntryOpen] = useState(false);
  // App controls the dialog when props are passed (so the menu can reach it
  // through the gate); otherwise fall back to internal state.
  const dialogOpen = entryOpen ?? internalEntryOpen;
  const setDialogOpen = onEntryOpenChange ?? setInternalEntryOpen;
  // Compile-time distribution channel. `null` until resolved (or if the call
  // fails) so the Buy button defaults to visible — only an explicit
  // "app_store" result hides it (App Store Review Guideline 3.1.1).
  const [buildSource, setBuildSource] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    getCachedBuildInfo()
      .then((info) => setBuildSource(info.source))
      .catch(() => {});
  }, []);

  const isAppStore = buildSource === "app_store";

  // "unknown" is exclusively the pre-fetch/initial state and is never a denial.
  // Keep it on the spinner (even if loading already flipped to false) so it
  // never flashes a splash mid-fetch and never leaks children.
  if (state === "unknown") {
    return (
      <div data-testid="license-loading" className="flex h-screen items-center justify-center text-text-muted">
        <SpinnerSvg className="h-6 w-6 text-text-faint" />
      </div>
    );
  }

  // Positive gate: ONLY an explicit "licensed" state renders the app. Any other
  // value (unlicensed, license_expired, a stale "trial", or a future backend
  // typo) falls through to the splash below — defense in depth.
  if (state === "licensed") {
    return (
      <>
        {children}
        <LicenseEntryDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      </>
    );
  }

  // Default (fall-through) for every non-licensed, non-unknown state: the splash.
  // license_expired keeps its personalized greeting; all other values get the
  // generic "requires a license" copy.
  const expired = state === "license_expired";
  const revoked = state === "revoked";
  const greeting = licensedTo ? `${licensedTo}, your` : "Your";
  const headline = revoked
    ? `${greeting} license was revoked.`
    : expired
      ? expiryDate
        ? `${greeting} license expired on ${expiryDate}.`
        : `${greeting} license has expired.`
      : "Lit requires a license to continue.";
  const subline = revoked
    ? (reason
        ? `Reason: ${reason}. If you believe this is a mistake, contact support@lit.solar. You can buy a new license or enter a different key to continue.`
        : "If you believe this is a mistake, contact support@lit.solar. You can buy a new license or enter a different key to continue.")
    : "Lit is a one-time purchase. Buy a license or enter your existing key to continue.";

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-bg-primary"
        data-testid="license-splash"
      >
        <p className="text-lg font-medium text-text-normal">{headline}</p>
        <p className="max-w-sm text-center text-sm text-text-muted">
          {subline}
        </p>
        <div className="flex gap-3">
          {!isAppStore && (
            <button
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:opacity-90"
              onClick={() => openUrl("https://lit.solar/buy")}
              data-testid="splash-buy-license"
            >
              Buy License
            </button>
          )}
          <button
            className="rounded border border-border-primary px-4 py-2 text-sm text-text-normal hover:bg-bg-secondary"
            onClick={() => setDialogOpen(true)}
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
      <LicenseEntryDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
