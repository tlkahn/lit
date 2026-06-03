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
  refresh: () => Promise<void>;
  ensureUnlocked: () => Promise<void>;
  settleUnlock: (success: boolean) => void;
  /** @internal test-only: clears pending settler without resolving/rejecting */
  _resetSettler: () => void;
}

let _settler: Settler | null = null;
let _pendingPromise: Promise<void> | null = null;

export const useSecretStoreStore = create<SecretStoreState>((set, get) => ({
  exists: false,
  unlocked: false,
  loading: false,
  promptOpen: false,

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
    if (get().unlocked || !get().exists) {
      return Promise.resolve();
    }

    // If there's already a pending promise, return it (avoid opening multiple prompts)
    if (_pendingPromise) {
      return _pendingPromise;
    }

    _pendingPromise = new Promise<void>((resolve, reject) => {
      _settler = { resolve, reject };
    });

    set({ promptOpen: true });

    return _pendingPromise;
  },

  settleUnlock: (success: boolean) => {
    if (!_settler) return;

    const settler = _settler;
    _settler = null;
    _pendingPromise = null;

    set({ promptOpen: false });

    if (success) {
      settler.resolve();
    } else {
      settler.reject(new Error("Passphrase entry cancelled"));
    }
  },

  _resetSettler: () => {
    _settler = null;
    _pendingPromise = null;
  },
}));
