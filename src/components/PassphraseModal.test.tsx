import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor, act } from "@testing-library/react";
import { PassphraseModal } from "./PassphraseModal";
import { useSecretStoreStore } from "../stores/secretStore";
import { mockInvoke } from "../test/tauri-mock";

async function resetStore(overrides: Partial<Record<string, unknown>> = {}) {
  useSecretStoreStore.getState()._resetSettler();
  useSecretStoreStore.setState({
    exists: false,
    unlocked: false,
    loading: false,
    migrationPromptOpen: false,
    ...overrides,
  });
}

describe("PassphraseModal (migration)", () => {
  beforeEach(async () => {
    await resetStore();
  });

  it("renders nothing when migrationPromptOpen is false", async () => {
    await resetStore({ migrationPromptOpen: false });
    const { container } = render(<PassphraseModal />);
    expect(container.querySelector("[data-testid='passphrase-modal-dialog']")).toBeNull();
  });

  it("renders dialog when migrationPromptOpen is true", async () => {
    await resetStore({ migrationPromptOpen: true });
    const { container } = render(<PassphraseModal />);
    expect(container.querySelector("[data-testid='passphrase-modal-dialog']")).toBeTruthy();
  });

  it("shows Migrate Secret Store title", async () => {
    await resetStore({ migrationPromptOpen: true });
    const { container } = render(<PassphraseModal />);
    const dialog = container.querySelector("[data-testid='passphrase-modal-dialog']")!;
    expect(dialog.textContent).toContain("Migrate Secret Store");
  });

  it("shows one password field", async () => {
    await resetStore({ migrationPromptOpen: true });
    const { container } = render(<PassphraseModal />);
    const inputs = container.querySelectorAll("input[type='password']");
    expect(inputs.length).toBe(1);
  });

  it("submit button disabled when field is empty", async () => {
    await resetStore({ migrationPromptOpen: true });
    const { container } = render(<PassphraseModal />);
    const btn = container.querySelector("[data-testid='passphrase-modal-submit']") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("submit button enabled when field has text", async () => {
    await resetStore({ migrationPromptOpen: true });
    const { container } = render(<PassphraseModal />);
    const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
    fireEvent.change(passInput, { target: { value: "mypass" } });
    const btn = container.querySelector("[data-testid='passphrase-modal-submit']") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("calls migrate and settles on successful submit", async () => {
    await resetStore({ migrationPromptOpen: true });

    mockInvoke((cmd) => {
      if (cmd === "migrate_secret_store") return undefined;
      if (cmd === "secret_store_status") return { exists: true, unlocked: true };
      throw new Error(`Unknown command: ${cmd}`);
    });

    // Set up a settler so settleMigration has something to resolve
    let settler: { resolve: () => void; reject: (err: Error) => void };
    const pendingPromise = new Promise<void>((resolve, reject) => {
      settler = { resolve, reject };
    });
    useSecretStoreStore.setState({ _settler: settler!, _pendingPromise: pendingPromise });

    const { container } = render(<PassphraseModal />);
    const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
    fireEvent.change(passInput, { target: { value: "old-pass" } });
    fireEvent.click(container.querySelector("[data-testid='passphrase-modal-submit']")!);

    await waitFor(() => {
      expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(false);
    });
  });

  it("shows error on wrong passphrase", async () => {
    await resetStore({ migrationPromptOpen: true });

    mockInvoke((cmd) => {
      if (cmd === "migrate_secret_store") throw new Error("Wrong passphrase");
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { container } = render(<PassphraseModal />);
    const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
    fireEvent.change(passInput, { target: { value: "wrongpass" } });
    fireEvent.click(container.querySelector("[data-testid='passphrase-modal-submit']")!);

    await waitFor(() => {
      const err = container.querySelector("[data-testid='passphrase-modal-error']");
      expect(err).toBeTruthy();
      expect(err!.textContent).toContain("Wrong passphrase");
    });
  });

  describe("cancel behavior", () => {
    it("Escape calls settleMigration(false)", async () => {
      await resetStore({ migrationPromptOpen: true });

      let settler: { resolve: () => void; reject: (err: Error) => void };
      const pendingPromise = new Promise<void>((resolve, reject) => {
        settler = { resolve, reject };
      });
      pendingPromise.catch(() => {});
      useSecretStoreStore.setState({ _settler: settler!, _pendingPromise: pendingPromise });

      render(<PassphraseModal />);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(false);
    });

    it("Cancel button calls settleMigration(false)", async () => {
      await resetStore({ migrationPromptOpen: true });

      let settler: { resolve: () => void; reject: (err: Error) => void };
      const pendingPromise = new Promise<void>((resolve, reject) => {
        settler = { resolve, reject };
      });
      pendingPromise.catch(() => {});
      useSecretStoreStore.setState({ _settler: settler!, _pendingPromise: pendingPromise });

      const { container } = render(<PassphraseModal />);
      fireEvent.click(container.querySelector("[data-testid='passphrase-modal-cancel']")!);
      expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(false);
    });
  });

  describe("keyboard confirm", () => {
    it("Enter submits with non-empty passphrase", async () => {
      await resetStore({ migrationPromptOpen: true });

      mockInvoke((cmd) => {
        if (cmd === "migrate_secret_store") return undefined;
        if (cmd === "secret_store_status") return { exists: true, unlocked: true };
        throw new Error(`Unknown command: ${cmd}`);
      });

      let settler: { resolve: () => void; reject: (err: Error) => void };
      const pendingPromise = new Promise<void>((resolve, reject) => {
        settler = { resolve, reject };
      });
      useSecretStoreStore.setState({ _settler: settler!, _pendingPromise: pendingPromise });

      const { container } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      fireEvent.change(passInput, { target: { value: "mypass" } });
      fireEvent.keyDown(document, { key: "Enter" });

      await waitFor(() => {
        expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(false);
      });
    });

    it("Enter does nothing when passphrase is empty", async () => {
      await resetStore({ migrationPromptOpen: true });
      const { container } = render(<PassphraseModal />);
      fireEvent.keyDown(document, { key: "Enter" });
      expect(container.querySelector("[data-testid='passphrase-modal-dialog']")).toBeTruthy();
    });
  });

  describe("no premature success / timer race", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("keeps modal open with no success tick while migrate is pending, then closes on resolve", async () => {
      vi.useFakeTimers();
      await resetStore({ migrationPromptOpen: true });

      let resolveMigrate: () => void;
      const migratePromise = new Promise<void>((resolve) => {
        resolveMigrate = resolve;
      });
      mockInvoke((cmd) => {
        if (cmd === "migrate_secret_store") return migratePromise;
        if (cmd === "secret_store_status") return { exists: true, unlocked: true };
        throw new Error(`Unknown command: ${cmd}`);
      });

      let settler: { resolve: () => void; reject: (err: Error) => void };
      const pendingPromise = new Promise<void>((resolve, reject) => {
        settler = { resolve, reject };
      });
      useSecretStoreStore.setState({ _settler: settler!, _pendingPromise: pendingPromise });

      const { container } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      fireEvent.change(passInput, { target: { value: "old-pass" } });
      fireEvent.click(container.querySelector("[data-testid='passphrase-modal-submit']")!);

      // While migrate is still pending, advancing timers must not hide the modal
      // nor show a premature success indicator.
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      expect(container.querySelector("[data-testid='passphrase-modal-dialog']")).toBeTruthy();
      expect(container.querySelector("[data-testid='passphrase-modal-tick']")).toBeNull();
      expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(true);

      // Now migrate resolves -> store settles and closes the prompt.
      vi.useRealTimers();
      await act(async () => {
        resolveMigrate!();
        await migratePromise;
      });

      await waitFor(() => {
        expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(false);
      });
    });
  });

  describe("reset on open", () => {
    it("clears fields and error when dialog reopens", async () => {
      await resetStore({ migrationPromptOpen: true });
      const { container, rerender } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      fireEvent.change(passInput, { target: { value: "typed-something" } });
      expect(passInput.value).toBe("typed-something");

      act(() => {
        useSecretStoreStore.setState({ migrationPromptOpen: false });
      });
      rerender(<PassphraseModal />);
      act(() => {
        useSecretStoreStore.setState({ migrationPromptOpen: true });
      });
      rerender(<PassphraseModal />);

      const reopened = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      expect(reopened.value).toBe("");
    });
  });
});
