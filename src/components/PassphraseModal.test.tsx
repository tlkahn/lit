import { describe, it, expect, beforeEach, vi } from "vitest";
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
    promptOpen: false,
    ...overrides,
  });
  if (overrides.promptOpen) {
    const statusExists = overrides.exists ?? false;
    mockInvoke((cmd) => {
      if (cmd === "secret_store_status") return { exists: statusExists, unlocked: false };
      throw new Error(`Unknown command: ${cmd}`);
    });
    useSecretStoreStore.setState({ promptOpen: false, unlocked: false });
    useSecretStoreStore.getState().ensureUnlocked().catch(() => {});
    await vi.waitFor(() => {
      expect(useSecretStoreStore.getState().promptOpen).toBe(true);
    });
    useSecretStoreStore.setState({
      ...overrides,
      promptOpen: true,
    });
  }
}

describe("PassphraseModal", () => {
  beforeEach(async () => {
    await resetStore();
  });

  it("renders nothing when promptOpen is false", async () => {
    await resetStore({ promptOpen: false });
    const { container } = render(<PassphraseModal />);
    expect(container.querySelector("[data-testid='passphrase-modal-dialog']")).toBeNull();
  });

  it("renders dialog when promptOpen is true", async () => {
    await resetStore({ promptOpen: true });
    const { container } = render(<PassphraseModal />);
    expect(container.querySelector("[data-testid='passphrase-modal-dialog']")).toBeTruthy();
  });

  describe("init mode (!exists)", () => {
    beforeEach(async () => {
      await resetStore({ promptOpen: true, exists: false });
    });

    it("shows Create Passphrase title", () => {
      const { container } = render(<PassphraseModal />);
      const dialog = container.querySelector("[data-testid='passphrase-modal-dialog']")!;
      expect(dialog.textContent).toContain("Create Passphrase");
    });

    it("shows two password fields", () => {
      const { container } = render(<PassphraseModal />);
      const inputs = container.querySelectorAll("input[type='password']");
      expect(inputs.length).toBe(2);
    });

    it("submit button is disabled when fields are empty", () => {
      const { container } = render(<PassphraseModal />);
      const btn = container.querySelector("[data-testid='passphrase-modal-submit']") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it("submit button is disabled when passwords do not match", () => {
      const { container } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      const confirmInput = container.querySelector("[data-testid='passphrase-modal-confirm']") as HTMLInputElement;
      fireEvent.change(passInput, { target: { value: "secret1abc" } });
      fireEvent.change(confirmInput, { target: { value: "secret2abc" } });
      const btn = container.querySelector("[data-testid='passphrase-modal-submit']") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it("submit button enabled when passwords match and non-empty", () => {
      const { container } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      const confirmInput = container.querySelector("[data-testid='passphrase-modal-confirm']") as HTMLInputElement;
      fireEvent.change(passInput, { target: { value: "secret12" } });
      fireEvent.change(confirmInput, { target: { value: "secret12" } });
      const btn = container.querySelector("[data-testid='passphrase-modal-submit']") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it("calls initSecretStore and settleUnlock(true) on successful submit", async () => {
      mockInvoke((cmd) => {
        if (cmd === "init_secret_store") return undefined;
        if (cmd === "secret_store_status") return { exists: true, unlocked: true };
        throw new Error(`Unknown command: ${cmd}`);
      });

      const { container } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      const confirmInput = container.querySelector("[data-testid='passphrase-modal-confirm']") as HTMLInputElement;
      fireEvent.change(passInput, { target: { value: "mypass12" } });
      fireEvent.change(confirmInput, { target: { value: "mypass12" } });
      fireEvent.click(container.querySelector("[data-testid='passphrase-modal-submit']")!);

      await waitFor(() => {
        expect(useSecretStoreStore.getState().promptOpen).toBe(false);
      });
    });

    it("shows error on initSecretStore failure", async () => {
      mockInvoke((cmd) => {
        if (cmd === "init_secret_store") throw new Error("Init failed");
        throw new Error(`Unknown command: ${cmd}`);
      });

      const { container } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      const confirmInput = container.querySelector("[data-testid='passphrase-modal-confirm']") as HTMLInputElement;
      fireEvent.change(passInput, { target: { value: "mypass12" } });
      fireEvent.change(confirmInput, { target: { value: "mypass12" } });
      fireEvent.click(container.querySelector("[data-testid='passphrase-modal-submit']")!);

      await waitFor(() => {
        const err = container.querySelector("[data-testid='passphrase-modal-error']");
        expect(err).toBeTruthy();
        expect(err!.textContent).toContain("Init failed");
      });
    });

    it("submit button is disabled when passphrase is shorter than 8 characters", () => {
      const { container } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      const confirmInput = container.querySelector("[data-testid='passphrase-modal-confirm']") as HTMLInputElement;
      // "short" is 5 characters -- below the 8-character minimum
      fireEvent.change(passInput, { target: { value: "short" } });
      fireEvent.change(confirmInput, { target: { value: "short" } });
      const btn = container.querySelector("[data-testid='passphrase-modal-submit']") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it("submit button is disabled when passphrase is exactly 7 characters", () => {
      const { container } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      const confirmInput = container.querySelector("[data-testid='passphrase-modal-confirm']") as HTMLInputElement;
      fireEvent.change(passInput, { target: { value: "seven77" } });
      fireEvent.change(confirmInput, { target: { value: "seven77" } });
      const btn = container.querySelector("[data-testid='passphrase-modal-submit']") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it("submit button is enabled when passphrase is exactly 8 characters and matches confirm", () => {
      const { container } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      const confirmInput = container.querySelector("[data-testid='passphrase-modal-confirm']") as HTMLInputElement;
      fireEvent.change(passInput, { target: { value: "exactly8" } });
      fireEvent.change(confirmInput, { target: { value: "exactly8" } });
      const btn = container.querySelector("[data-testid='passphrase-modal-submit']") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it("shows minimum length hint when passphrase is too short in init mode", () => {
      const { container } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      fireEvent.change(passInput, { target: { value: "short" } });
      const hint = container.querySelector("[data-testid='passphrase-modal-hint']");
      expect(hint).toBeTruthy();
      expect(hint!.textContent).toContain("at least 8 characters");
    });

    it("does not show minimum length hint when passphrase meets requirement", () => {
      const { container } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      fireEvent.change(passInput, { target: { value: "longenough" } });
      const hint = container.querySelector("[data-testid='passphrase-modal-hint']");
      expect(hint).toBeNull();
    });
  });

  describe("unlock mode (exists && !unlocked)", () => {
    beforeEach(async () => {
      await resetStore({ promptOpen: true, exists: true, unlocked: false });
    });

    it("shows Unlock title", () => {
      const { container } = render(<PassphraseModal />);
      const dialog = container.querySelector("[data-testid='passphrase-modal-dialog']")!;
      expect(dialog.textContent).toContain("Unlock");
    });

    it("shows one password field", () => {
      const { container } = render(<PassphraseModal />);
      const inputs = container.querySelectorAll("input[type='password']");
      expect(inputs.length).toBe(1);
    });

    it("submit button disabled when field is empty", () => {
      const { container } = render(<PassphraseModal />);
      const btn = container.querySelector("[data-testid='passphrase-modal-submit']") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it("submit button enabled when field has text", () => {
      const { container } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      fireEvent.change(passInput, { target: { value: "mypass" } });
      const btn = container.querySelector("[data-testid='passphrase-modal-submit']") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it("calls unlockSecretStore and settleUnlock(true) on success", async () => {
      mockInvoke((cmd) => {
        if (cmd === "unlock_secret_store") return undefined;
        if (cmd === "secret_store_status") return { exists: true, unlocked: true };
        throw new Error(`Unknown command: ${cmd}`);
      });

      const { container } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      fireEvent.change(passInput, { target: { value: "mypass" } });
      fireEvent.click(container.querySelector("[data-testid='passphrase-modal-submit']")!);

      await waitFor(() => {
        expect(useSecretStoreStore.getState().promptOpen).toBe(false);
      });
    });

    it("shows error on wrong passphrase", async () => {
      mockInvoke((cmd) => {
        if (cmd === "unlock_secret_store") throw new Error("Wrong passphrase");
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

    it("user can retry after wrong passphrase", async () => {
      let callCount = 0;
      mockInvoke((cmd) => {
        if (cmd === "unlock_secret_store") {
          callCount++;
          if (callCount === 1) throw new Error("Wrong passphrase");
          return undefined;
        }
        if (cmd === "secret_store_status") return { exists: true, unlocked: true };
        throw new Error(`Unknown command: ${cmd}`);
      });

      const { container } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;

      // First attempt -- wrong password
      fireEvent.change(passInput, { target: { value: "wrong" } });
      fireEvent.click(container.querySelector("[data-testid='passphrase-modal-submit']")!);
      await waitFor(() => {
        expect(container.querySelector("[data-testid='passphrase-modal-error']")).toBeTruthy();
      });

      // Second attempt -- correct password
      fireEvent.change(passInput, { target: { value: "correct" } });
      fireEvent.click(container.querySelector("[data-testid='passphrase-modal-submit']")!);
      await waitFor(() => {
        expect(useSecretStoreStore.getState().promptOpen).toBe(false);
      });
    });
  });

  describe("cancel behavior", () => {
    it("Escape calls settleUnlock(false)", async () => {
      await resetStore({ promptOpen: true, exists: true, unlocked: false });
      render(<PassphraseModal />);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(useSecretStoreStore.getState().promptOpen).toBe(false);
    });

    it("Cancel button calls settleUnlock(false)", async () => {
      await resetStore({ promptOpen: true, exists: true, unlocked: false });
      const { container } = render(<PassphraseModal />);
      fireEvent.click(container.querySelector("[data-testid='passphrase-modal-cancel']")!);
      expect(useSecretStoreStore.getState().promptOpen).toBe(false);
    });
  });

  describe("reset on open", () => {
    it("clears fields and error when dialog reopens", async () => {
      await resetStore({ promptOpen: true, exists: true, unlocked: false });
      const { container, rerender } = render(<PassphraseModal />);
      const passInput = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      fireEvent.change(passInput, { target: { value: "typed-something" } });
      expect(passInput.value).toBe("typed-something");

      // Close and reopen
      act(() => {
        useSecretStoreStore.setState({ promptOpen: false });
      });
      rerender(<PassphraseModal />);
      act(() => {
        useSecretStoreStore.setState({ promptOpen: true });
      });
      rerender(<PassphraseModal />);

      const reopened = container.querySelector("[data-testid='passphrase-modal-passphrase']") as HTMLInputElement;
      expect(reopened.value).toBe("");
    });
  });
});
