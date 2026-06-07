import { useState, useEffect, useCallback, useRef } from "react";
import { useSecretStoreStore } from "../stores/secretStore";

export function PassphraseModal() {
  const migrationPromptOpen = useSecretStoreStore((s) => s.migrationPromptOpen);
  const migrate = useSecretStoreStore((s) => s.migrate);
  const settleMigration = useSecretStoreStore((s) => s.settleMigration);

  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (migrationPromptOpen && !prevOpenRef.current) {
      setPassphrase("");
      setError(null);
      setSubmitting(false);
    }
    prevOpenRef.current = migrationPromptOpen;
  }, [migrationPromptOpen]);

  const handleCancel = useCallback(() => {
    settleMigration(false);
  }, [settleMigration]);

  const canSubmit = passphrase.length > 0 && !submitting;

  const passphraseRef = useRef(passphrase);
  passphraseRef.current = passphrase;
  const canSubmitRef = useRef(canSubmit);
  canSubmitRef.current = canSubmit;

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await migrate(passphraseRef.current);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [migrate]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleCancel();
        return;
      }
      if (e.key === "Enter" && canSubmitRef.current) {
        e.stopPropagation();
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleCancel, handleSubmit],
  );

  useEffect(() => {
    if (!migrationPromptOpen) return;
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [migrationPromptOpen, handleKeyDown]);

  if (!migrationPromptOpen) return null;

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
          Migrate Secret Store
        </p>
        <p className="mb-3 text-xs text-text-muted">
          Your API keys were encrypted with a custom passphrase. Enter it to migrate to automatic encryption.
        </p>
        <input
          type="password"
          className="mb-3 w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal placeholder:text-text-muted outline-none focus:border-accent"
          value={passphrase}
          onChange={(e) => {
            setPassphrase(e.target.value);
            setError(null);
          }}
          placeholder="Enter old passphrase"
          data-testid="passphrase-modal-passphrase"
          autoFocus
        />
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
            {submitting ? "Migrating…" : "Migrate"}
          </button>
        </div>
      </div>
    </div>
  );
}
