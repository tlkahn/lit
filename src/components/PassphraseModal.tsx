import { useState, useEffect, useCallback, useRef } from "react";
import { useSecretStoreStore } from "../stores/secretStore";
import { initSecretStore, unlockSecretStore } from "../lib/ipc";

const MIN_PASSPHRASE_LENGTH = 8;

export function PassphraseModal() {
  const promptOpen = useSecretStoreStore((s) => s.promptOpen);
  const exists = useSecretStoreStore((s) => s.exists);
  const settleUnlock = useSecretStoreStore((s) => s.settleUnlock);
  const refresh = useSecretStoreStore((s) => s.refresh);

  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showTick, setShowTick] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isInitMode = !exists;

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (promptOpen && !prevOpenRef.current) {
      setPassphrase("");
      setConfirm("");
      setError(null);
      setSubmitting(false);
      setShowTick(false);
      setDismissed(false);
    }
    prevOpenRef.current = promptOpen;
  }, [promptOpen]);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  const handleCancel = useCallback(() => {
    settleUnlock(false);
  }, [settleUnlock]);

  const canSubmit = isInitMode
    ? passphrase.length >= MIN_PASSPHRASE_LENGTH && passphrase === confirm && !submitting
    : passphrase.length > 0 && !submitting;

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setShowTick(true);
    setError(null);
    dismissTimerRef.current = setTimeout(() => setDismissed(true), 400);
    try {
      if (isInitMode) {
        await initSecretStore(passphrase);
      } else {
        await unlockSecretStore(passphrase);
      }
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
      await refresh();
      settleUnlock(true);
    } catch (e) {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
      setDismissed(false);
      setShowTick(false);
      setSubmitting(false);
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    }
  }, [isInitMode, passphrase, refresh, settleUnlock]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !dismissed) {
        handleCancel();
        return;
      }
      if (e.key === "Enter" && canSubmit && !dismissed) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleCancel, canSubmit, dismissed, handleSubmit],
  );

  useEffect(() => {
    if (!promptOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [promptOpen, handleKeyDown]);

  if (!promptOpen) return null;
  if (dismissed) return null;

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
        {isInitMode && passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE_LENGTH && (
          <p className="mb-3 text-xs text-text-muted" data-testid="passphrase-modal-hint">
            Passphrase must be at least {MIN_PASSPHRASE_LENGTH} characters
          </p>
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
            {showTick ? (
              <span data-testid="passphrase-modal-tick">{""}</span>
            ) : (
              isInitMode ? "Create" : "Unlock"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
