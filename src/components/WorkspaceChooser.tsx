import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore, getRecentWorkspaces } from "../stores/workspace";
import { openWorkspaceWindow } from "../lib/ipc";

export function WorkspaceChooser() {
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const loading = useWorkspaceStore((s) => s.loading);
  const error = useWorkspaceStore((s) => s.error);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    setRecent(getRecentWorkspaces());
  }, []);

  const handleOpen = async () => {
    const selected = await open({ directory: true });
    if (selected) {
      await openWorkspace(selected);
    }
  };

  const handleOpenInNewWindow = async () => {
    const selected = await open({ directory: true });
    if (selected) {
      await openWorkspaceWindow(selected);
    }
  };

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-white dark:bg-neutral-800">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-800 dark:text-neutral-100">
        Lit
      </h1>
      <p className="mb-8 text-neutral-500 dark:text-neutral-400">
        Open a folder to get started
      </p>
      <div className="flex gap-3">
        <button
          onClick={handleOpen}
          disabled={loading}
          className="rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Opening..." : "Open Workspace"}
        </button>
        <button
          onClick={handleOpenInNewWindow}
          disabled={loading}
          className="rounded-lg border border-neutral-300 px-6 py-3 text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-700"
        >
          Open in New Window
        </button>
      </div>
      {recent.length > 0 && (
        <div className="mt-8 w-full max-w-md" data-testid="recent-workspaces">
          <h2 className="mb-2 text-sm font-medium text-neutral-500 dark:text-neutral-400">
            Recent Workspaces
          </h2>
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-700 dark:border-neutral-700">
            {recent.map((path) => (
              <li key={path}>
                <button
                  onClick={() => openWorkspace(path)}
                  className="w-full truncate px-4 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  title={path}
                >
                  {path}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p className="mt-4 text-sm text-red-500" data-testid="workspace-error">
          {error}
        </p>
      )}
    </div>
  );
}
