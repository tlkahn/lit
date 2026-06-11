import { materializeCitation, type PageMeta } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";

/**
 * Canonical materialize-and-navigate sequence shared between:
 * - ReferenceLibrary.tsx  (React component)
 * - citeprocTooltip.ts    (CM6 imperative DOM builder)
 *
 * Steps:
 * 1. materializeCitation(bibKey)   → creates the note on disk
 * 2. Append the returned PageMeta to the workspace pages array
 * 3. recordDeparture()             → record jump history for back-navigation
 * 4. selectPage(meta.relative_path) → navigate to the new page
 *
 * NOTE: This helper intentionally does NOT call invalidateBibKeyStatesCache()
 * or loadBibKeyStates(). Each call-site handles its own local cache refresh
 * after materializeAndOpen resolves, avoiding a circular import:
 * - Tooltip  → invalidateBibKeyStatesCache()
 * - ReferenceLibrary → loadBibKeyStates()
 */
export async function materializeAndOpen(
  bibKey: string,
  opts?: { recordDeparture?: () => void },
): Promise<PageMeta> {
  const meta = await materializeCitation(bibKey);

  useWorkspaceStore.setState((state: { pages: PageMeta[] }) => ({
    pages: [...state.pages, meta],
  }));

  opts?.recordDeparture?.();

  useWorkspaceStore.getState().selectPage(meta.relative_path);

  return meta;
}
