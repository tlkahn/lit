import { create } from "zustand";
import { secretStoreStatus, autoUnlockSecretStore, migrateSecretStore } from "../lib/ipc";

interface Settler {
  resolve: () => void;
  reject: (err: Error) => void;
}

export interface SecretStoreState {
  exists: boolean;
  unlocked: boolean;
  needsMigration: boolean;
  loading: boolean;
  migrationPromptOpen: boolean;
  /** @internal settler for the pending migration promise */
  _settler: Settler | null;
  /** @internal the pending promise */
  _pendingPromise: Promise<void> | null;
  refresh: () => Promise<void>;
  ensureUnlocked: () => Promise<void>;
  migrate: (oldPassphrase: string) => Promise<void>;
  settleMigration: (success: boolean) => void;
  /** @internal test-only: clears pending settler without resolving/rejecting */
  _resetSettler: () => void;
}

export const useSecretStoreStore = create<SecretStoreState>((set, get) => ({
  exists: false,
  unlocked: false,
  needsMigration: false,
  loading: false,
  migrationPromptOpen: false,
  _settler: null,
  _pendingPromise: null,

  refresh: async () => {
    set({ loading: true });
    try {
      const status = await secretStoreStatus();
      set({
        exists: status.exists,
        unlocked: status.unlocked,
        needsMigration: status.needsMigration,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  ensureUnlocked: () => {
    const state = get();
    if (state.unlocked) {
      return Promise.resolve();
    }

    if (state._pendingPromise) {
      return state._pendingPromise;
    }

    let settler: Settler;
    const pendingPromise = new Promise<void>((resolve, reject) => {
      settler = { resolve, reject };
    });

    set({ _settler: settler!, _pendingPromise: pendingPromise });

    autoUnlockSecretStore().then((ok) => {
      if (ok) {
        get().refresh().then(() => {
          const s = get()._settler;
          if (s) {
            set({ _settler: null, _pendingPromise: null });
            s.resolve();
          }
        });
        return;
      }
      get().refresh().then(() => {
        set({ migrationPromptOpen: true });
      });
    }).catch(() => {
      get().refresh().then(() => {
        if (get().unlocked) {
          const s = get()._settler;
          if (s) {
            set({ _settler: null, _pendingPromise: null });
            s.resolve();
          }
          return;
        }
        set({ migrationPromptOpen: true });
      });
    });

    return pendingPromise;
  },

  migrate: async (oldPassphrase: string) => {
    await migrateSecretStore(oldPassphrase);
    await get().refresh();
    get().settleMigration(true);
  },

  settleMigration: (success: boolean) => {
    const { _settler } = get();
    if (!_settler) return;

    const settler = _settler;
    set({ _settler: null, _pendingPromise: null, migrationPromptOpen: false });

    if (success) {
      settler.resolve();
    } else {
      settler.reject(new Error("Migration cancelled"));
    }
  },

  _resetSettler: () => {
    set({ _settler: null, _pendingPromise: null });
  },
}));
