import { useEffect } from "react";
import { syncLicenseMenu } from "../lib/ipc";
import { useLicenseStore } from "../stores/license";

export function useMenuLicenseSync() {
  const state = useLicenseStore((s) => s.state);

  useEffect(() => {
    if (state === "unknown") return;
    syncLicenseMenu(state).catch(() => {});
  }, [state]);
}
