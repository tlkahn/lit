import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSecretStoreStore } from "./secretStore";
import { mockInvoke } from "../test/tauri-mock";

function resetStore() {
  // Reset the store state including settler fields (now part of the store)
  useSecretStoreStore.setState({
    exists: false,
    unlocked: false,
    loading: false,
    promptOpen: false,
    _settler: null,
    _pendingPromise: null,
  });
}

describe("secretStore store", () => {
  beforeEach(() => {
    resetStore();
  });

  describe("initial state", () => {
    it("starts with exists false", () => {
      expect(useSecretStoreStore.getState().exists).toBe(false);
    });

    it("starts with unlocked false", () => {
      expect(useSecretStoreStore.getState().unlocked).toBe(false);
    });

    it("starts with loading false", () => {
      expect(useSecretStoreStore.getState().loading).toBe(false);
    });

    it("starts with promptOpen false", () => {
      expect(useSecretStoreStore.getState().promptOpen).toBe(false);
    });
  });

  describe("refresh", () => {
    it("updates exists and unlocked from IPC status", async () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") {
          return { exists: true, unlocked: true };
        }
        throw new Error(`Unknown command: ${cmd}`);
      });

      await useSecretStoreStore.getState().refresh();

      const state = useSecretStoreStore.getState();
      expect(state.exists).toBe(true);
      expect(state.unlocked).toBe(true);
    });

    it("sets loading true during refresh and false after", async () => {
      let resolveInvoke: ((v: unknown) => void) | undefined;
      const invokePromise = new Promise((resolve) => {
        resolveInvoke = resolve;
      });

      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") {
          return invokePromise;
        }
        throw new Error(`Unknown command: ${cmd}`);
      });

      const refreshPromise = useSecretStoreStore.getState().refresh();
      // loading should be true while waiting
      expect(useSecretStoreStore.getState().loading).toBe(true);

      resolveInvoke!({ exists: false, unlocked: false });
      await refreshPromise;

      expect(useSecretStoreStore.getState().loading).toBe(false);
    });

    it("sets loading false on IPC failure", async () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") {
          throw new Error("IPC error");
        }
        throw new Error(`Unknown command: ${cmd}`);
      });

      await useSecretStoreStore.getState().refresh();

      const state = useSecretStoreStore.getState();
      expect(state.loading).toBe(false);
      // exists/unlocked remain unchanged on error
      expect(state.exists).toBe(false);
      expect(state.unlocked).toBe(false);
    });

    it("reflects exists true unlocked false", async () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") {
          return { exists: true, unlocked: false };
        }
        throw new Error(`Unknown command: ${cmd}`);
      });

      await useSecretStoreStore.getState().refresh();

      const state = useSecretStoreStore.getState();
      expect(state.exists).toBe(true);
      expect(state.unlocked).toBe(false);
    });
  });

  describe("ensureUnlocked", () => {
    it("resolves immediately when already unlocked", async () => {
      useSecretStoreStore.setState({ exists: true, unlocked: true });

      await useSecretStoreStore.getState().ensureUnlocked();
      // Should not open prompt
      expect(useSecretStoreStore.getState().promptOpen).toBe(false);
    });

    it("sets promptOpen true when locked", async () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") return { exists: true, unlocked: false };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const promise = useSecretStoreStore.getState().ensureUnlocked();
      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().promptOpen).toBe(true);
      });

      useSecretStoreStore.getState().settleUnlock(false);
      promise.catch(() => {});
    });

    it("opens prompt in init mode when store does not exist yet", async () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") return { exists: false, unlocked: false };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: false, unlocked: false });

      const promise = useSecretStoreStore.getState().ensureUnlocked();
      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().promptOpen).toBe(true);
      });

      useSecretStoreStore.getState().settleUnlock(false);
      promise.catch(() => {});
    });

    it("resolves when settleUnlock(true) is called in init mode (no store yet)", async () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") return { exists: false, unlocked: false };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: false, unlocked: false });

      const promise = useSecretStoreStore.getState().ensureUnlocked();
      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().promptOpen).toBe(true);
      });

      useSecretStoreStore.getState().settleUnlock(true);

      await expect(promise).resolves.toBeUndefined();
      expect(useSecretStoreStore.getState().promptOpen).toBe(false);
    });

    it("rejects when settleUnlock(false) is called in init mode (no store yet)", async () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") return { exists: false, unlocked: false };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: false, unlocked: false });

      const promise = useSecretStoreStore.getState().ensureUnlocked();
      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().promptOpen).toBe(true);
      });

      useSecretStoreStore.getState().settleUnlock(false);

      await expect(promise).rejects.toThrow("Passphrase entry cancelled");
      expect(useSecretStoreStore.getState().promptOpen).toBe(false);
    });

    it("resolves when settleUnlock(true) is called", async () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") return { exists: true, unlocked: false };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const promise = useSecretStoreStore.getState().ensureUnlocked();
      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().promptOpen).toBe(true);
      });

      useSecretStoreStore.getState().settleUnlock(true);

      await expect(promise).resolves.toBeUndefined();
      expect(useSecretStoreStore.getState().promptOpen).toBe(false);
    });

    it("rejects when settleUnlock(false) is called", async () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") return { exists: true, unlocked: false };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const promise = useSecretStoreStore.getState().ensureUnlocked();
      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().promptOpen).toBe(true);
      });

      useSecretStoreStore.getState().settleUnlock(false);

      await expect(promise).rejects.toThrow("Passphrase entry cancelled");
      expect(useSecretStoreStore.getState().promptOpen).toBe(false);
    });

    it("multiple ensureUnlocked calls return the same promise", () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") return { exists: true, unlocked: false };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const p1 = useSecretStoreStore.getState().ensureUnlocked();
      const p2 = useSecretStoreStore.getState().ensureUnlocked();

      expect(p1).toBe(p2);

      // Clean up
      useSecretStoreStore.getState().settleUnlock(false);
      p1.catch(() => {});
      p2.catch(() => {});
    });

    it("resolves without prompt when refresh reveals already unlocked", async () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") return { exists: true, unlocked: true };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: false, unlocked: false });

      const promise = useSecretStoreStore.getState().ensureUnlocked();
      await expect(promise).resolves.toBeUndefined();
      expect(useSecretStoreStore.getState().promptOpen).toBe(false);
    });

    it("refresh updates exists before opening prompt so modal shows correct mode", async () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") return { exists: true, unlocked: false };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: false, unlocked: false });

      const promise = useSecretStoreStore.getState().ensureUnlocked();
      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().promptOpen).toBe(true);
      });

      expect(useSecretStoreStore.getState().exists).toBe(true);

      useSecretStoreStore.getState().settleUnlock(false);
      promise.catch(() => {});
    });

    it("settleUnlock with no pending promise is a no-op", () => {
      // Should not throw
      useSecretStoreStore.getState().settleUnlock(true);
      expect(useSecretStoreStore.getState().promptOpen).toBe(false);
    });

    it("setState with _settler and _pendingPromise null clears pending unlock", async () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") return { exists: true, unlocked: false };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const p1 = useSecretStoreStore.getState().ensureUnlocked();
      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().promptOpen).toBe(true);
      });

      useSecretStoreStore.setState({
        promptOpen: false,
        _settler: null,
        _pendingPromise: null,
      });

      const p2 = useSecretStoreStore.getState().ensureUnlocked();
      expect(p2).not.toBe(p1);

      useSecretStoreStore.getState().settleUnlock(false);
      p1.catch(() => {});
      p2.catch(() => {});
    });

    it("settler state is accessible via getState", () => {
      const state = useSecretStoreStore.getState();
      // After the fix, these properties exist on the store state
      expect(state).toHaveProperty("_settler");
      expect(state).toHaveProperty("_pendingPromise");
      expect(state._settler).toBeNull();
      expect(state._pendingPromise).toBeNull();
    });

    it("after settling, a new ensureUnlocked creates a fresh promise", async () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") return { exists: true, unlocked: false };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const p1 = useSecretStoreStore.getState().ensureUnlocked();
      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().promptOpen).toBe(true);
      });
      useSecretStoreStore.getState().settleUnlock(false);
      await p1.catch(() => {});

      const p2 = useSecretStoreStore.getState().ensureUnlocked();
      expect(p2).not.toBe(p1);

      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().promptOpen).toBe(true);
      });
      useSecretStoreStore.getState().settleUnlock(true);
      await expect(p2).resolves.toBeUndefined();
    });
  });
});
