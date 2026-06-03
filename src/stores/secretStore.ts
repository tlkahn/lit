import { create } from "zustand";
import { secretStoreStatus } from "../lib/ipc";

interface Settler {
  resolve: () => void;
  reject: (err: Error) => void;
}

export interface SecretStoreState {
  exists: boolean;
  unlocked: boolean;
  loading: boolean;
  promptOpen: boolean;
  /** @internal settler for the pending unlock promise */
  _settler: Settler | null;
  /** @internal the pending unlock promise */
  _pendingPromise: Promise<void> | null;
  refresh: () => Promise<void>;
  ensureUnlocked: () => Promise<void>;
  settleUnlock: (success: boolean) => void;
  /** @internal test-only: clears pending settler without resolving/rejecting */
  _resetSettler: () => void;
}

export const useSecretStoreStore = create<SecretStoreState>((set, get) => ({
  exists: false,
  unlocked: false,
  loading: false,
  promptOpen: false,
  _settler: null,
  _pendingPromise: null,

  refresh: async () => {
    set({ loading: true });
    try {
      const status = await secretStoreStatus();
      set({ exists: status.exists, unlocked: status.unlocked, loading: false });
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

    get().refresh().then(() => {
      if (get().unlocked) {
        const s = get()._settler;
        if (s) {
          set({ _settler: null, _pendingPromise: null });
          s.resolve();
        }
        return;
      }
      set({ promptOpen: true });
    });

    return pendingPromise;
  },

  settleUnlock: (success: boolean) => {
    const { _settler } = get();
    if (!_settler) return;

    const settler = _settler;
    set({ _settler: null, _pendingPromise: null, promptOpen: false });

    if (success) {
      settler.resolve();
    } else {
      settler.reject(new Error("Passphrase entry cancelled"));
    }
  },

  _resetSettler: () => {
    set({ _settler: null, _pendingPromise: null });
  },
}));
