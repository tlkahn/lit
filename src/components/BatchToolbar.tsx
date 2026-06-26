import { memo, useState, useRef, useEffect } from "react";
import { CARDBOX_COLORS } from "../lib/ipc";

interface BatchToolbarProps {
  selectedCount: number;
  onMergeToDraft: () => void;
  onGroup: () => void;
  onLinkAll: () => void;
  onSetColor: (color: string) => void;
  onClearColor: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onClear: () => void;
}

export const BatchToolbar = memo(function BatchToolbar({
  selectedCount,
  onMergeToDraft,
  onGroup,
  onLinkAll,
  onSetColor,
  onClearColor,
  onPin,
  onUnpin,
  onClear,
}: BatchToolbarProps) {
  const [colorOpen, setColorOpen] = useState(false);
  const colorRef = useRef<HTMLDivElement>(null);

  // Close color popover on outside click
  useEffect(() => {
    if (!colorOpen) return;
    const handler = (e: MouseEvent) => {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) {
        setColorOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colorOpen]);

  if (selectedCount < 2) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-bg-primary px-3 py-2 shadow-lg"
      data-testid="batch-toolbar"
    >
      <span className="mr-2 text-xs text-text-muted" data-testid="batch-count">
        {selectedCount} selected
      </span>

      <button
        className="rounded px-2 py-1 text-xs text-text-normal hover:bg-bg-hover"
        onClick={onMergeToDraft}
        data-testid="batch-merge-to-draft"
      >
        Merge to Draft
      </button>

      <button
        className="rounded px-2 py-1 text-xs text-text-normal hover:bg-bg-hover"
        onClick={onGroup}
        data-testid="batch-group"
      >
        Group
      </button>

      <button
        className="rounded px-2 py-1 text-xs text-text-normal hover:bg-bg-hover"
        onClick={onLinkAll}
        data-testid="batch-link-all"
      >
        Link All
      </button>

      <div className="relative" ref={colorRef}>
        <button
          className="rounded px-2 py-1 text-xs text-text-normal hover:bg-bg-hover"
          onClick={() => setColorOpen((v) => !v)}
          data-testid="batch-color"
        >
          Color
        </button>
        {colorOpen && (
          <div
            className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-bg-primary p-2 shadow-lg"
            data-testid="batch-color-popover"
          >
            {CARDBOX_COLORS.map((color) => (
              <button
                key={color}
                className="h-5 w-5 rounded-full border border-border transition-transform hover:scale-110"
                style={{ backgroundColor: `rgba(var(--chip-${color}), 0.6)` }}
                onClick={() => { onSetColor(color); setColorOpen(false); }}
                data-testid={`batch-color-${color}`}
                aria-label={color}
              />
            ))}
            <button
              className="ml-1 rounded px-1.5 py-0.5 text-[10px] text-text-faint hover:bg-bg-hover"
              onClick={() => { onClearColor(); setColorOpen(false); }}
              data-testid="batch-color-none"
            >
              None
            </button>
          </div>
        )}
      </div>

      <button
        className="rounded px-2 py-1 text-xs text-text-normal hover:bg-bg-hover"
        onClick={onPin}
        data-testid="batch-pin"
      >
        Pin
      </button>

      <button
        className="rounded px-2 py-1 text-xs text-text-normal hover:bg-bg-hover"
        onClick={onUnpin}
        data-testid="batch-unpin"
      >
        Unpin
      </button>

      <div className="mx-1 h-4 w-px bg-border" />

      <button
        className="rounded px-2 py-1 text-xs text-text-faint hover:bg-bg-hover hover:text-text-normal"
        onClick={onClear}
        data-testid="batch-clear"
      >
        Clear
      </button>
    </div>
  );
});
