import { usePreferencesStore, setCompanionSearchPath } from "../stores/preferences";

const inputClass =
  "flex-1 rounded-md bg-bg-tertiary px-2.5 py-1 text-sm text-text-normal outline-none focus:ring-1 focus:ring-accent";
const iconBtnClass =
  "px-1.5 text-sm text-text-muted hover:text-text-normal disabled:opacity-30 disabled:hover:text-text-muted";

export function CompanionSearchPathSettings() {
  const paths = usePreferencesStore((s) => s.companionSearchPath);

  const update = (next: string[]) => setCompanionSearchPath(next);

  const editAt = (i: number, value: string) => {
    const next = paths.slice();
    next[i] = value;
    update(next);
  };

  const deleteAt = (i: number) => {
    update(paths.filter((_, idx) => idx !== i));
  };

  const moveUp = (i: number) => {
    if (i <= 0) return;
    const next = paths.slice();
    [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
    update(next);
  };

  const moveDown = (i: number) => {
    if (i >= paths.length - 1) return;
    const next = paths.slice();
    [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
    update(next);
  };

  return (
    <div data-testid="companion-search-path-settings" className="space-y-2">
      <p className="text-xs text-text-muted">
        Directories to search for a note's PDF/Markdown companion. <code>.</code> is the workspace root.
      </p>
      {paths.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            data-testid={`companion-path-input-${i}`}
            className={inputClass}
            value={p}
            onChange={(e) => editAt(i, e.target.value)}
          />
          <button
            data-testid={`companion-path-up-${i}`}
            className={iconBtnClass}
            disabled={i === 0}
            onClick={() => moveUp(i)}
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            data-testid={`companion-path-down-${i}`}
            className={iconBtnClass}
            disabled={i === paths.length - 1}
            onClick={() => moveDown(i)}
            aria-label="Move down"
          >
            ↓
          </button>
          <button
            data-testid={`companion-path-delete-${i}`}
            className={iconBtnClass}
            onClick={() => deleteAt(i)}
            aria-label="Delete"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        data-testid="companion-path-add"
        className="text-sm font-medium text-text-muted hover:text-text-normal"
        onClick={() => update([...paths, ""])}
      >
        + Add Search Path
      </button>
    </div>
  );
}
