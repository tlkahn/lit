import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSecretStoreStore } from "./secretStore";
import { mockInvoke } from "../test/tauri-mock";

function resetStore() {
  useSecretStoreStore.setState({
    exists: false,
    unlocked: false,
    needsMigration: false,
    loading: false,
    migrationPromptOpen: false,
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

    it("starts with needsMigration false", () => {
      expect(useSecretStoreStore.getState().needsMigration).toBe(false);
    });

    it("starts with loading false", () => {
      expect(useSecretStoreStore.getState().loading).toBe(false);
    });

    it("starts with migrationPromptOpen false", () => {
      expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(false);
    });
  });

  describe("refresh", () => {
    it("updates exists, unlocked, and needsMigration from IPC status", async () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") {
          return { exists: true, unlocked: true, needsMigration: false };
        }
        throw new Error(`Unknown command: ${cmd}`);
      });

      await useSecretStoreStore.getState().refresh();

      const state = useSecretStoreStore.getState();
      expect(state.exists).toBe(true);
      expect(state.unlocked).toBe(true);
      expect(state.needsMigration).toBe(false);
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

      resolveInvoke!({ exists: false, unlocked: false, needsMigration: false });
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

    it("reflects exists true unlocked false needsMigration true", async () => {
      mockInvoke((cmd) => {
        if (cmd === "secret_store_status") {
          return { exists: true, unlocked: false, needsMigration: true };
        }
        throw new Error(`Unknown command: ${cmd}`);
      });

      await useSecretStoreStore.getState().refresh();

      const state = useSecretStoreStore.getState();
      expect(state.exists).toBe(true);
      expect(state.unlocked).toBe(false);
      expect(state.needsMigration).toBe(true);
    });
  });

  describe("ensureUnlocked", () => {
    it("resolves immediately when already unlocked", async () => {
      useSecretStoreStore.setState({ exists: true, unlocked: true });

      await useSecretStoreStore.getState().ensureUnlocked();
      // Should not open migration prompt
      expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(false);
    });

    it("resolves without prompt when auto-unlock succeeds", async () => {
      mockInvoke((cmd) => {
        if (cmd === "auto_unlock_secret_store") return true;
        if (cmd === "secret_store_status") return { exists: true, unlocked: true, needsMigration: false };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      await useSecretStoreStore.getState().ensureUnlocked();

      expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(false);
      expect(useSecretStoreStore.getState().unlocked).toBe(true);
    });

    it("opens migration prompt when auto-unlock returns false", async () => {
      mockInvoke((cmd) => {
        if (cmd === "auto_unlock_secret_store") return false;
        if (cmd === "secret_store_status") return { exists: true, unlocked: false, needsMigration: true };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const promise = useSecretStoreStore.getState().ensureUnlocked();
      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(true);
      });

      useSecretStoreStore.getState().settleMigration(false);
      promise.catch(() => {});
    });

    it("opens migration prompt when auto-unlock throws", async () => {
      mockInvoke((cmd) => {
        if (cmd === "auto_unlock_secret_store") throw new Error("auto-unlock failed");
        if (cmd === "secret_store_status") return { exists: true, unlocked: false, needsMigration: true };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const promise = useSecretStoreStore.getState().ensureUnlocked();
      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(true);
      });

      useSecretStoreStore.getState().settleMigration(false);
      promise.catch(() => {});
    });

    it("resolves when auto-unlock throws but refresh reveals unlocked", async () => {
      mockInvoke((cmd) => {
        if (cmd === "auto_unlock_secret_store") throw new Error("auto-unlock failed");
        if (cmd === "secret_store_status") return { exists: true, unlocked: true, needsMigration: false };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      await useSecretStoreStore.getState().ensureUnlocked();

      expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(false);
      expect(useSecretStoreStore.getState().unlocked).toBe(true);
    });

    it("resolves when settleMigration(true) is called", async () => {
      mockInvoke((cmd) => {
        if (cmd === "auto_unlock_secret_store") return false;
        if (cmd === "secret_store_status") return { exists: true, unlocked: false, needsMigration: true };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const promise = useSecretStoreStore.getState().ensureUnlocked();
      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(true);
      });

      useSecretStoreStore.getState().settleMigration(true);

      await expect(promise).resolves.toBeUndefined();
      expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(false);
    });

    it("rejects when settleMigration(false) is called", async () => {
      mockInvoke((cmd) => {
        if (cmd === "auto_unlock_secret_store") return false;
        if (cmd === "secret_store_status") return { exists: true, unlocked: false, needsMigration: true };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const promise = useSecretStoreStore.getState().ensureUnlocked();
      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(true);
      });

      useSecretStoreStore.getState().settleMigration(false);

      await expect(promise).rejects.toThrow("Migration cancelled");
      expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(false);
    });

    it("multiple ensureUnlocked calls return the same promise", () => {
      mockInvoke((cmd) => {
        if (cmd === "auto_unlock_secret_store") return false;
        if (cmd === "secret_store_status") return { exists: true, unlocked: false, needsMigration: true };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const p1 = useSecretStoreStore.getState().ensureUnlocked();
      const p2 = useSecretStoreStore.getState().ensureUnlocked();

      expect(p1).toBe(p2);

      // Clean up
      useSecretStoreStore.getState().settleMigration(false);
      p1.catch(() => {});
      p2.catch(() => {});
    });

    it("settleMigration with no pending promise is a no-op", () => {
      // Should not throw
      useSecretStoreStore.getState().settleMigration(true);
      expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(false);
    });

    it("setState with _settler and _pendingPromise null clears pending unlock", async () => {
      mockInvoke((cmd) => {
        if (cmd === "auto_unlock_secret_store") return false;
        if (cmd === "secret_store_status") return { exists: true, unlocked: false, needsMigration: true };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const p1 = useSecretStoreStore.getState().ensureUnlocked();
      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(true);
      });

      useSecretStoreStore.setState({
        migrationPromptOpen: false,
        _settler: null,
        _pendingPromise: null,
      });

      const p2 = useSecretStoreStore.getState().ensureUnlocked();
      expect(p2).not.toBe(p1);

      useSecretStoreStore.getState().settleMigration(false);
      p1.catch(() => {});
      p2.catch(() => {});
    });

    it("settler state is accessible via getState", () => {
      const state = useSecretStoreStore.getState();
      expect(state).toHaveProperty("_settler");
      expect(state).toHaveProperty("_pendingPromise");
      expect(state._settler).toBeNull();
      expect(state._pendingPromise).toBeNull();
    });

    it("after settling, a new ensureUnlocked creates a fresh promise", async () => {
      mockInvoke((cmd) => {
        if (cmd === "auto_unlock_secret_store") return false;
        if (cmd === "secret_store_status") return { exists: true, unlocked: false, needsMigration: true };
        throw new Error(`Unknown command: ${cmd}`);
      });
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const p1 = useSecretStoreStore.getState().ensureUnlocked();
      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(true);
      });
      useSecretStoreStore.getState().settleMigration(false);
      await p1.catch(() => {});

      const p2 = useSecretStoreStore.getState().ensureUnlocked();
      expect(p2).not.toBe(p1);

      await vi.waitFor(() => {
        expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(true);
      });
      useSecretStoreStore.getState().settleMigration(true);
      await expect(p2).resolves.toBeUndefined();
    });
  });
});
