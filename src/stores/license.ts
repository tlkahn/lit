import { create } from "zustand";
import { getLicenseStatus, activateLicense, checkOnlineValidation } from "../lib/ipc";

export type LicenseState = "unknown" | "unlicensed" | "licensed" | "license_expired";

interface LicenseStore {
  state: LicenseState;
  licensedTo: string | null;
  source: string | null;
  expiresAt: number | null;
  expiryDate: string | null;
  loading: boolean;
  error: string | null;
  fetchStatus: () => Promise<void>;
  activate: (key: string) => Promise<boolean>;
  clearError: () => void;
}

export const useLicenseStore = create<LicenseStore>((set) => ({
  state: "unknown",
  licensedTo: null,
  source: null,
  expiresAt: null,
  expiryDate: null,
  loading: true,
  error: null,

  fetchStatus: async () => {
    const res = await getLicenseStatus();
    set({
      state: res.state,
      licensedTo: res.licensed_to ?? null,
      source: res.source ?? null,
      expiresAt: res.expires_at ?? null,
      expiryDate: res.expiry_date ?? null,
      loading: false,
    });

    checkOnlineValidation()
      .then(async (online) => {
        if (online.action === "revoked") {
          const updated = await getLicenseStatus();
          set({
            state: updated.state,
            licensedTo: updated.licensed_to ?? null,
            source: updated.source ?? null,
            expiresAt: updated.expires_at ?? null,
            expiryDate: updated.expiry_date ?? null,
          });
        }
      })
      .catch(() => {});
  },

  activate: async (key: string) => {
    try {
      const res = await activateLicense(key);
      set({
        state: res.state,
        licensedTo: res.licensed_to ?? null,
        source: res.source ?? null,
        expiresAt: res.expires_at ?? null,
        expiryDate: res.expiry_date ?? null,
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
