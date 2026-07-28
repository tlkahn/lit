import { useCallback } from "react";
import { useModalLock } from "../hooks/useModalLock";

interface CardboxShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: { key: string; description: string }[] = [
  { key: "← → ↑ ↓", description: "Navigate cards in grid" },
  { key: "Enter", description: "Expand / collapse card" },
  { key: "⌘ Enter", description: "Navigate to card source" },
  { key: "L", description: "Open link picker (expanded card)" },
  { key: "P", description: "Toggle pin" },
  { key: "F", description: "Flip card (when quote exists)" },
  { key: "N", description: "Toggle note (expanded card)" },
  { key: "C", description: "Show connections (expanded card)" },
  { key: "S", description: "Toggle document / workspace scope" },
  { key: "Esc", description: "Exit connections mode" },
  { key: "Esc", description: "Clear selection" },
  { key: "⌘ A", description: "Select all visible cards" },
  { key: "⌘ Click", description: "Toggle card selection" },
  { key: "⇧ Click", description: "Range select cards" },
  { key: "⌘ Z", description: "Undo last operation" },
  { key: "⌘ ⇧ Z", description: "Redo last operation" },
  { key: "?", description: "Show this shortcuts overlay" },
];

export function CardboxShortcutsOverlay({ open, onClose }: CardboxShortcutsOverlayProps) {
  useModalLock(open);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[20vh]"
      data-testid="shortcuts-overlay-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="flex max-h-[60vh] w-[420px] flex-col overflow-hidden rounded-lg bg-bg-primary shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-testid="shortcuts-overlay-panel"
        tabIndex={-1}
        ref={(el) => {
          if (el) el.focus();
        }}
      >
        <div className="border-b border-bg-hover px-4 py-3 text-sm font-medium text-text-normal">
          Keyboard Shortcuts
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {SHORTCUTS.map((s) => (
            <div
              key={s.description}
              className="flex items-center justify-between py-1.5"
              data-testid="shortcut-entry"
            >
              <kbd className="inline-flex items-center rounded bg-bg-hover px-2 py-0.5 font-mono text-xs font-medium text-text-accent">
                {s.key}
              </kbd>
              <span className="text-sm text-text-normal">{s.description}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
