import { create } from "zustand";
import { getLicenseStatus, activateLicense, checkOnlineValidation } from "../lib/ipc";

export type LicenseState = "unknown" | "unlicensed" | "licensed" | "license_expired" | "revoked";

interface LicenseStore {
  state: LicenseState;
  licensedTo: string | null;
  source: string | null;
  expiresAt: number | null;
  expiryDate: string | null;
  reason: string | null;
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
  reason: null,
  loading: true,
  error: null,

  fetchStatus: async () => {
    try {
      const res = await getLicenseStatus();
      set({
        state: res.state,
        licensedTo: res.licensed_to ?? null,
        source: res.source ?? null,
        expiresAt: res.expires_at ?? null,
        expiryDate: res.expiry_date ?? null,
        reason: res.reason ?? null,
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
              reason: updated.reason ?? null,
            });
          }
        })
        .catch(() => {});
    } catch (e) {
      set({ state: "unlicensed", loading: false, error: String(e) });
    }
  },

  activate: async (key: string) => {
    try {
      const res = await activateLicense(key);
      const ok = res.state === "licensed";
      const error = ok
        ? null
        : res.state === "license_expired"
          ? "This license key has expired"
          : res.state === "revoked"
            ? "This license key has been revoked"
            : "This license key is not valid";
      set({
        state: res.state,
        licensedTo: res.licensed_to ?? null,
        source: res.source ?? null,
        expiresAt: res.expires_at ?? null,
        expiryDate: res.expiry_date ?? null,
        reason: res.reason ?? null,
        error,
      });
      return ok;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  clearError: () => set({ error: null }),
}));
