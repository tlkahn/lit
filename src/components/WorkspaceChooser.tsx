import { open } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore } from "../stores/workspace";

export function WorkspaceChooser() {
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const loading = useWorkspaceStore((s) => s.loading);
  const error = useWorkspaceStore((s) => s.error);

  const handleOpen = async () => {
    const selected = await open({ directory: true });
    if (selected) {
      await openWorkspace(selected);
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
      <button
        onClick={handleOpen}
        disabled={loading}
        className="rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Opening..." : "Open Workspace"}
      </button>
      {error && (
        <p className="mt-4 text-sm text-red-500" data-testid="workspace-error">
          {error}
        </p>
      )}
    </div>
  );
}
