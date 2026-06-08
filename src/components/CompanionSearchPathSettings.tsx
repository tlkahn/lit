import { useEffect, useState } from "react";
import { usePreferencesStore, setCompanionSearchPath } from "../stores/preferences";

const inputClass =
  "flex-1 rounded-md bg-bg-tertiary px-2.5 py-1 text-sm text-text-normal outline-none focus:ring-1 focus:ring-accent";
const iconBtnClass =
  "px-1.5 text-sm text-text-muted hover:text-text-normal disabled:opacity-30 disabled:hover:text-text-muted";

export function CompanionSearchPathSettings() {
  const storePaths = usePreferencesStore((s) => s.companionSearchPath);
  const [paths, setPaths] = useState(storePaths);
  // Stable per-row identity, kept in lockstep with `paths`, so React keys move
  // each input DOM node with its logical path on reorder (preserving cursor/IME
  // state) instead of rebinding by array index.
  const [ids, setIds] = useState<string[]>(() => storePaths.map(() => crypto.randomUUID()));

  // Keep the local buffer in sync with external store updates (reload,
  // failed-write rollback in setCompanionSearchPath, etc.). Reconcile ids to
  // match the new length, reusing existing ids by position and minting fresh
  // ones only for added slots. Reusing by position is essential: structural
  // actions (reorder, delete, add) commit through setCompanionSearchPath, which
  // synchronously echoes back into storePaths and re-fires this effect. A
  // wholesale id reset here would remount every input on each reorder, defeating
  // the stable-key fix (carrying cursor/IME state to the wrong row).
  useEffect(() => {
    setPaths(storePaths);
    setIds((prev) => storePaths.map((_, idx) => prev[idx] ?? crypto.randomUUID()));
  }, [storePaths]);

  // Persist the entire list. Used for blur/Enter and structural actions.
  // Trim and drop empty/whitespace-only entries so a blank row never silently
  // aliases the workspace root (Path::new("").join(...) == root.join(...)).
  const commit = (next: string[]) => {
    const cleaned = next.map((p) => p.trim()).filter((p) => p.length > 0);
    setCompanionSearchPath(cleaned);
  };

  // Keystrokes only mutate the local buffer — no disk write per character.
  const editAt = (i: number, value: string) => {
    setPaths((prev) => {
      const next = prev.slice();
      next[i] = value;
      return next;
    });
  };

  const deleteAt = (i: number) => {
    const next = paths.filter((_, idx) => idx !== i);
    setPaths(next);
    setIds((prev) => prev.filter((_, idx) => idx !== i));
    commit(next);
  };

  const moveUp = (i: number) => {
    if (i <= 0) return;
    const next = paths.slice();
    [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
    setPaths(next);
    setIds((prev) => {
      const nextIds = prev.slice();
      [nextIds[i - 1], nextIds[i]] = [nextIds[i]!, nextIds[i - 1]!];
      return nextIds;
    });
    commit(next);
  };

  const moveDown = (i: number) => {
    if (i >= paths.length - 1) return;
    const next = paths.slice();
    [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
    setPaths(next);
    setIds((prev) => {
      const nextIds = prev.slice();
      [nextIds[i], nextIds[i + 1]] = [nextIds[i + 1]!, nextIds[i]!];
      return nextIds;
    });
    commit(next);
  };

  const addPath = () => {
    // Add a blank row to the local buffer only. It is persisted only once the
    // user types a value and blurs / presses Enter (via the filtered commit).
    setPaths((prev) => [...prev, ""]);
    setIds((prev) => [...prev, crypto.randomUUID()]);
  };

  return (
    <div data-testid="companion-search-path-settings" className="space-y-2">
      <p className="text-xs text-text-muted">
        Directories to search for a note's PDF/Markdown companion. Supports relative paths (from workspace root), absolute paths, and ~ for home directory.
      </p>
      {paths.map((p, i) => (
        <div key={ids[i]} className="flex items-center gap-1.5">
          <input
            data-testid={`companion-path-input-${i}`}
            className={inputClass}
            value={p}
            onChange={(e) => editAt(i, e.target.value)}
            onBlur={() => commit(paths)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit(paths);
            }}
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
        onClick={addPath}
      >
        + Add Search Path
      </button>
    </div>
  );
}
