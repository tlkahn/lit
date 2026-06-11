import { materializeCitation, type PageMeta } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";

/**
 * Canonical materialize-and-navigate sequence shared between:
 * - useMaterializeCitation.ts (React hook — ReferenceLibrary, GraphView)
 * - citeprocTooltip.ts        (CM6 imperative DOM builder)
 *
 * Steps:
 * 1. materializeCitation(bibKey)    → creates the note on disk
 * 2. Replace-or-append the returned PageMeta in the workspace pages array
 *    (a racing refreshPages may have already added a stale entry)
 * 3. recordDeparture()              → record jump history for back-navigation
 * 4. navigate(meta.relative_path)   → defaults to selectPage
 *
 * Rejects with the backend error on failure; callers own error handling
 * (the tooltip relies on the "already exists" message to recover).
 *
 * NOTE: This helper intentionally does NOT call invalidateBibKeyStatesCache()
 * or loadBibKeyStates(). Each call-site handles its own local cache refresh
 * after materializeAndOpen resolves, avoiding a circular import:
 * - Tooltip  → invalidateBibKeyStatesCache()
 * - ReferenceLibrary → loadBibKeyStates()
 */
export async function materializeAndOpen(
  bibKey: string,
  opts?: {
    recordDeparture?: () => void;
    navigate?: (relativePath: string) => void;
  },
): Promise<PageMeta> {
  const meta = await materializeCitation(bibKey);

  useWorkspaceStore.setState((state: { pages: PageMeta[] }) => {
    const exists = state.pages.some(
      (p) => p.relative_path === meta.relative_path,
    );
    return {
      pages: exists
        ? state.pages.map((p) =>
            p.relative_path === meta.relative_path ? meta : p,
          )
        : [...state.pages, meta],
    };
  });

  opts?.recordDeparture?.();

  if (opts?.navigate) {
    opts.navigate(meta.relative_path);
  } else {
    useWorkspaceStore.getState().selectPage(meta.relative_path);
  }

  return meta;
}
