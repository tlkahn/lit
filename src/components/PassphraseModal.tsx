import { useState, useEffect, useCallback, useRef } from "react";
import { useSecretStoreStore } from "../stores/secretStore";
import { initSecretStore, unlockSecretStore } from "../lib/ipc";

export function PassphraseModal() {
  const promptOpen = useSecretStoreStore((s) => s.promptOpen);
  const exists = useSecretStoreStore((s) => s.exists);
  const settleUnlock = useSecretStoreStore((s) => s.settleUnlock);
  const refresh = useSecretStoreStore((s) => s.refresh);

  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isInitMode = !exists;

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (promptOpen && !prevOpenRef.current) {
      setPassphrase("");
      setConfirm("");
      setError(null);
      setSubmitting(false);
    }
    prevOpenRef.current = promptOpen;
  }, [promptOpen]);

  const handleCancel = useCallback(() => {
    settleUnlock(false);
  }, [settleUnlock]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancel();
    },
    [handleCancel],
  );

  useEffect(() => {
    if (!promptOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [promptOpen, handleKeyDown]);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (isInitMode) {
        await initSecretStore(passphrase);
      } else {
        await unlockSecretStore(passphrase);
      }
      await refresh();
      settleUnlock(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [isInitMode, passphrase, refresh, settleUnlock]);

  if (!promptOpen) return null;

  const canSubmit = isInitMode
    ? passphrase.length > 0 && passphrase === confirm && !submitting
    : passphrase.length > 0 && !submitting;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="passphrase-modal-backdrop"
    >
      <div
        className="w-96 rounded-lg bg-bg-primary p-5 shadow-lg"
        data-testid="passphrase-modal-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-sm font-medium text-text-normal">
          {isInitMode ? "Create Passphrase" : "Unlock Secret Store"}
        </p>
        {isInitMode && (
          <p className="mb-3 text-xs text-text-muted">
            Choose a passphrase to encrypt your API keys. You will need it each time you restart the app.
          </p>
        )}
        <input
          type="password"
          className="mb-3 w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal placeholder:text-text-muted outline-none focus:border-accent"
          value={passphrase}
          onChange={(e) => {
            setPassphrase(e.target.value);
            setError(null);
          }}
          placeholder={isInitMode ? "Passphrase" : "Enter passphrase"}
          data-testid="passphrase-modal-passphrase"
          autoFocus
        />
        {isInitMode && (
          <input
            type="password"
            className="mb-3 w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal placeholder:text-text-muted outline-none focus:border-accent"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setError(null);
            }}
            placeholder="Confirm passphrase"
            data-testid="passphrase-modal-confirm"
          />
        )}
        {error && (
          <p className="mb-3 text-xs text-red-500" data-testid="passphrase-modal-error">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
            onClick={handleCancel}
            data-testid="passphrase-modal-cancel"
          >
            Cancel
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-40"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="passphrase-modal-submit"
          >
            {isInitMode ? "Create" : "Unlock"}
          </button>
        </div>
      </div>
    </div>
  );
}
