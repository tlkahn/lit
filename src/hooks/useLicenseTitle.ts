import { useEffect } from "react";
import { useLicenseStore } from "../stores/license";

export function useLicenseTitle() {
  const state = useLicenseStore((s) => s.state);

  useEffect(() => {
    if (state === "unknown") return;

    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().setTitle("Lit");
    }).catch(() => {});
  }, [state]);
}
