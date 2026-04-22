import { useWorkspaceStore } from "../stores/workspace";

export function Outline() {
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const headings = useWorkspaceStore((s) => s.currentPageHeadings);

  if (!currentPagePath) {
    return <p className="p-3 text-sm text-text-faint">No page selected</p>;
  }

  if (headings.length === 0) {
    return <p className="p-3 text-sm text-text-faint">No headings</p>;
  }

  return (
    <div className="flex-1 overflow-y-auto px-1">
      {headings.map((h, i) => (
        <button
          key={`${h.line}-${i}`}
          className="w-full truncate rounded py-0.5 text-left text-sm text-text-normal hover:bg-bg-hover"
          style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("lit:scroll-to-line", { detail: { line: h.line } }),
            );
          }}
        >
          {h.text || `H${h.level}`}
        </button>
      ))}
    </div>
  );
}
