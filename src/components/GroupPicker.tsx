import { useState, useEffect, useRef, useCallback } from "react";
import type { GroupInfo } from "../lib/ipc";

interface GroupPickerProps {
  open: boolean;
  groups: Record<string, GroupInfo>;
  onSelect: (groupId: string) => void;
  onClose: () => void;
}

export function GroupPicker({ open, groups, onSelect, onClose }: GroupPickerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const groupEntries = Object.entries(groups);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (groupEntries.length === 0) return;
    const activeEl = listRef.current?.querySelector('[data-active="true"]');
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, groupEntries.length]);

  const handleSelect = useCallback(
    (groupId: string) => {
      onSelect(groupId);
      onClose();
    },
    [onSelect, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (groupEntries.length > 0) {
          setActiveIndex((prev) => (prev + 1) % groupEntries.length);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (groupEntries.length > 0) {
          setActiveIndex((prev) => (prev - 1 + groupEntries.length) % groupEntries.length);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        const entry = groupEntries[activeIndex];
        if (entry) {
          handleSelect(entry[0]);
        }
      }
    },
    [groupEntries, activeIndex, handleSelect, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[20vh]"
      data-testid="group-picker-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="flex max-h-[60vh] w-[360px] flex-col overflow-hidden rounded-lg bg-bg-primary shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="Group picker"
        data-testid="group-picker-panel"
        tabIndex={-1}
        ref={(el) => {
          if (el) el.focus();
        }}
      >
        <div className="border-b border-bg-hover px-4 py-3 text-sm font-medium text-text-normal">
          Add to Group
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto">
          {groupEntries.length === 0 && (
            <div className="px-4 py-3 text-sm text-text-muted">No groups available</div>
          )}

          {groupEntries.map(([groupId, info], i) => (
            <div
              key={groupId}
              data-testid="group-picker-item"
              data-active={i === activeIndex ? "true" : "false"}
              className={`cursor-pointer px-4 py-2 text-sm ${i === activeIndex ? "bg-bg-hover" : ""}`}
              onClick={() => handleSelect(groupId)}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-text-normal truncate">{info.name}</span>
                <span className="ml-2 shrink-0 text-xs text-text-muted">
                  {info.order.length} {info.order.length === 1 ? "card" : "cards"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
