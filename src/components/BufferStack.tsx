import { usePaneStore, collectLeaves, findLeaf } from "../stores/panes";

export function BufferStack() {
  const root = usePaneStore((s) => s.root);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);

  const leaves = collectLeaves(root);
  const openBuffers = leaves.filter((l) => l.pagePath !== null);

  if (openBuffers.length === 0) return null;

  const focusedLeaf = findLeaf(root, focusedPaneId);
  const displayPath =
    focusedLeaf?.pagePath ?? openBuffers[0]!.pagePath!;
  const otherCount = openBuffers.length - 1;

  if (otherCount === 0) {
    return <span data-testid="buffer-stack-label">{displayPath}</span>;
  }

  return (
    <button data-testid="buffer-stack-chip" className="flex items-center gap-1">
      <span data-testid="buffer-stack-label">{displayPath}</span>
      <span data-testid="buffer-stack-count">(+{otherCount})</span>
    </button>
  );
}
