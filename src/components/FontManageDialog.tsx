import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import type { FontCategory } from "../stores/preferences";
import { listSystemFonts } from "../lib/ipc";

interface FontManageDialogProps {
  category: FontCategory;
  fonts: string[];
  onSave: (fonts: string[]) => void;
  onCancel: () => void;
}

const CATEGORY_LABELS: Record<FontCategory, string> = {
  interface: "Interface Font",
  text: "Text Font",
  monospace: "Monospace Font",
};

const iconBtnClass =
  "px-1.5 text-sm text-text-muted hover:text-text-normal disabled:opacity-30 disabled:hover:text-text-muted";

export function FontManageDialog({ category, fonts, onSave, onCancel }: FontManageDialogProps) {
  const [localFonts, setLocalFonts] = useState(fonts);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [systemFontSet, setSystemFontSet] = useState<Set<string>>(new Set());
  const [newFontName, setNewFontName] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listSystemFonts()
      .then((names) => {
        setSystemFonts(names);
        setSystemFontSet(new Set(names.map((n) => n.toLowerCase())));
      })
      .catch(() => {});
  }, []);

  const isAvailable = useCallback(
    (name: string) => systemFontSet.has(name.toLowerCase()),
    [systemFontSet],
  );

  const moveUp = (i: number) => {
    if (i <= 0) return;
    setLocalFonts((prev) => {
      const next = prev.slice();
      [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
      return next;
    });
  };

  const moveDown = (i: number) => {
    setLocalFonts((prev) => {
      if (i >= prev.length - 1) return prev;
      const next = prev.slice();
      [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
      return next;
    });
  };

  const removeAt = (i: number) => {
    setLocalFonts((prev) => prev.filter((_, idx) => idx !== i));
  };

  const addFont = () => {
    const trimmed = newFontName.trim();
    if (!trimmed) return;
    if (localFonts.some((f) => f.toLowerCase() === trimmed.toLowerCase())) return;
    setLocalFonts((prev) => [...prev, trimmed]);
    setNewFontName("");
    addInputRef.current?.focus();
  };

  const datalistId = useMemo(() => `font-datalist-${category}`, [category]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 60, backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={(e) => { if (e.target === overlayRef.current) onCancel(); }}
    >
      <div
        className="bg-bg-primary rounded-lg shadow-xl border border-border-subtle w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <h3 className="text-sm font-medium text-text-normal">Manage {CATEGORY_LABELS[category]}</h3>
          <button className="text-text-muted hover:text-text-normal text-sm" onClick={onCancel}>
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
          {localFonts.length === 0 && (
            <p className="text-xs text-text-muted py-2">No fonts configured. Add one below.</p>
          )}
          {localFonts.map((name, i) => {
            const available = systemFontSet.size > 0 && isAvailable(name);
            return (
              <div key={`${name}-${i}`} className="flex items-center gap-2 py-1">
                <span
                  className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: systemFontSet.size === 0 ? "#999" : available ? "#34d399" : "#9ca3af" }}
                  title={systemFontSet.size === 0 ? "Loading..." : available ? "Installed" : "Not found"}
                />
                <span
                  className="flex-1 text-sm text-text-normal truncate"
                  style={{ fontFamily: `"${name}", sans-serif` }}
                >
                  {name}
                </span>
                <button className={iconBtnClass} disabled={i === 0} onClick={() => moveUp(i)} aria-label="Move up">
                  ↑
                </button>
                <button className={iconBtnClass} disabled={i === localFonts.length - 1} onClick={() => moveDown(i)} aria-label="Move down">
                  ↓
                </button>
                <button className={iconBtnClass} onClick={() => removeAt(i)} aria-label="Remove">
                  ✕
                </button>
              </div>
            );
          })}

          <div className="flex items-center gap-2 pt-2">
            <input
              ref={addInputRef}
              className="flex-1 rounded-md bg-bg-tertiary px-2.5 py-1 text-sm text-text-normal outline-none focus:ring-1 focus:ring-accent"
              value={newFontName}
              onChange={(e) => setNewFontName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addFont(); }}
              placeholder="Type a font name..."
              list={datalistId}
            />
            <button
              className="text-sm font-medium text-text-muted hover:text-text-normal px-2"
              onClick={addFont}
            >
              + Add
            </button>
          </div>
          <datalist id={datalistId}>
            {systemFonts.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle">
          <button
            className="px-3 py-1 text-sm rounded bg-bg-secondary text-text-muted hover:text-text-normal"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1 text-sm rounded bg-accent text-on-accent hover:opacity-90"
            onClick={() => onSave(localFonts)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
