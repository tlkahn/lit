import { useEffect } from "react";
import { Menu } from "@tauri-apps/api/menu";
import { useLicenseStore } from "../stores/license";

const MENU_IDS = {
  buy_license: (state: string) => state === "trial" || state === "expiring_soon" || state === "expired",
  enter_license_key: (state: string) => state !== "licensed",
  license_info: (state: string) => state === "licensed",
} as const;

export function useMenuLicenseSync() {
  const state = useLicenseStore((s) => s.state);

  useEffect(() => {
    if (state === "unknown") return;

    Menu.default().then(async (menu) => {
      for (const [id, shouldEnable] of Object.entries(MENU_IDS)) {
        const item = await menu.get(id);
        if (item && "setEnabled" in item) {
          await (item as { setEnabled: (enabled: boolean) => Promise<void> }).setEnabled(shouldEnable(state));
        }
      }
    }).catch(() => {});
  }, [state]);
}
