import { useEffect } from "react";
import { useLicenseStore } from "../stores/license";

export function useLicenseTitle() {
  const state = useLicenseStore((s) => s.state);
  const daysRemaining = useLicenseStore((s) => s.daysRemaining);

  useEffect(() => {
    if (state === "unknown") return;

    let title = "Lit";
    if ((state === "trial" || state === "expiring_soon") && daysRemaining != null) {
      const dayWord = daysRemaining === 1 ? "day" : "days";
      title = `Lit (${daysRemaining} ${dayWord} left in trial)`;
    }

    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().setTitle(title);
    }).catch(() => {});
  }, [state, daysRemaining]);
}
