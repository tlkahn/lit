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
    <div className="flex h-screen flex-col items-center justify-center bg-bg-primary-alt">
      <h1 className="mb-6 text-2xl font-semibold text-text-normal">
        Lit
      </h1>
      <p className="mb-8 text-text-faint">
        Open a folder to get started
      </p>
      <div className="flex gap-3">
        <button
          onClick={handleOpen}
          disabled={loading}
          className="rounded-lg bg-interactive-accent px-6 py-3 text-text-on-accent hover:bg-interactive-accent-hover disabled:opacity-50"
        >
          {loading ? "Opening..." : "Open Workspace"}
        </button>
        <button
          onClick={handleOpenInNewWindow}
          disabled={loading}
          className="rounded-lg border border-border px-6 py-3 text-text-normal hover:bg-bg-hover disabled:opacity-50"
        >
          Open in New Window
        </button>
      </div>
      {recent.length > 0 && (
        <div className="mt-8 w-full max-w-md" data-testid="recent-workspaces">
          <h2 className="mb-2 text-sm font-medium text-text-faint">
            Recent Workspaces
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {recent.map((path) => (
              <li key={path}>
                <button
                  onClick={() => openWorkspace(path)}
                  className="w-full truncate px-4 py-2 text-left text-sm text-text-normal hover:bg-bg-hover"
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
        <p className="mt-4 text-sm text-text-error" data-testid="workspace-error">
          {error}
        </p>
      )}
    </div>
  );
}
