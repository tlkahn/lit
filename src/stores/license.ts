import { create } from "zustand";
import { getLicenseStatus, activateLicense } from "../lib/ipc";

export type LicenseState = "unknown" | "trial" | "expiring_soon" | "expired" | "licensed";

interface LicenseStore {
  state: LicenseState;
  daysRemaining: number | null;
  licensedTo: string | null;
  loading: boolean;
  error: string | null;
  fetchStatus: () => Promise<void>;
  activate: (key: string) => Promise<boolean>;
  clearError: () => void;
}

export const useLicenseStore = create<LicenseStore>((set) => ({
  state: "unknown",
  daysRemaining: null,
  licensedTo: null,
  loading: true,
  error: null,

  fetchStatus: async () => {
    const res = await getLicenseStatus();
    set({
      state: res.state,
      daysRemaining: res.days_remaining ?? null,
      licensedTo: res.licensed_to ?? null,
      loading: false,
    });
  },

  activate: async (key: string) => {
    try {
      const res = await activateLicense(key);
      set({
        state: res.state,
        daysRemaining: res.days_remaining ?? null,
        licensedTo: res.licensed_to ?? null,
        error: null,
      });
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  clearError: () => set({ error: null }),
}));
