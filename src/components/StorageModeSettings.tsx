import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getWorkspaceStorageMode, setWorkspaceStorageMode, type StorageMode } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { SegmentedControl } from "./SegmentedControl";

const MODE_LABELS: Record<StorageMode, string> = {
  files: "Files",
  db: "Database",
};

/** Phase-4 migration progress event payload (`lit:migration-progress`). */
interface MigrationProgress {
  current: number;
  total: number;
  phase: string;
}

/**
 * Per-workspace storage-mode toggle (Files vs Database).
 *
 * Self-contained: reads/writes the mode via IPC and manages its own local
 * state, mirroring `LlmProviderSettings`. Switching opens an inline
 * confirmation dialog, then writes the new mode and reloads the workspace.
 *
 * Phase 3 limitation: the backend currently writes config only and does NOT
 * migrate content, so no `lit:migration-progress` events fire yet. The progress
 * listener is wired up regardless so Phase 4 lights it up with zero changes.
 */
export function StorageModeSettings() {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const pageCount = useWorkspaceStore((s) => s.pages.length);

  const [mode, setMode] = useState<StorageMode>("files");
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<StorageMode | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!workspacePath) return;
    const reqId = ++reqRef.current;
    getWorkspaceStorageMode()
      .then((m) => {
        if (reqId !== reqRef.current) return;
        setMode(m);
        setLoaded(true);
      })
      .catch((e) => {
        if (reqId !== reqRef.current) return;
        setError(String(e));
        setLoaded(true);
      });
  }, [workspacePath]);

  if (!workspacePath) {
    return (
      <div data-testid="storage-mode-no-workspace" className="text-sm text-text-muted">
        Open a workspace to change its storage mode.
      </div>
    );
  }

  if (!loaded) {
    return <div className="text-sm text-text-muted">Loading…</div>;
  }

  function handleChange(next: string) {
    const target = next as StorageMode;
    if (target === mode) return;
    setError(null);
    setPending(target);
  }

  async function handleConfirm() {
    if (!pending) return;
    const target = pending;
    setMigrating(true);
    setProgress(null);
    setError(null);

    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listen<MigrationProgress>("lit:migration-progress", (e) => {
        setProgress(e.payload);
      });
      await setWorkspaceStorageMode(target);
      setMode(target);
      setPending(null);
      await useWorkspaceStore.getState().reloadWorkspace();
    } catch (e) {
      setError(String(e));
    } finally {
      if (unlisten) unlisten();
      setMigrating(false);
    }
  }

  function handleCancel() {
    setPending(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <SegmentedControl
        options={[
          { value: "files", label: "Files" },
          { value: "db", label: "Database" },
        ]}
        value={mode}
        onChange={handleChange}
        testId="settings-storageMode"
        label="Storage Mode"
      />

      {pending && (
        <div data-testid="storage-mode-confirm" className="rounded-md bg-bg-tertiary p-3 text-sm">
          <p className="mb-2 text-text-normal">
            This will migrate {pageCount} {pageCount === 1 ? "note" : "notes"} to{" "}
            {MODE_LABELS[pending]}. Source data is kept as a backup. Continue?
          </p>
          {migrating && (
            <div data-testid="storage-mode-progress" className="mb-2 text-text-muted">
              {progress ? `Migrating ${progress.current}/${progress.total}…` : "Migrating…"}
            </div>
          )}
          <div className="flex gap-2">
            <button
              data-testid="storage-mode-confirm-yes"
              onClick={handleConfirm}
              disabled={migrating}
              className="rounded bg-accent px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              data-testid="storage-mode-confirm-no"
              onClick={handleCancel}
              disabled={migrating}
              className="rounded bg-bg-primary px-3 py-1 text-sm text-text-normal disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div data-testid="storage-mode-error" className="text-sm text-red-500">
          {error}
        </div>
      )}
    </div>
  );
}
