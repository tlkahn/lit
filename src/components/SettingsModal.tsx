import { useEffect, useCallback, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePreferencesStore, type PreferencesState } from "../stores/preferences";
import { setPreference } from "../lib/ipc";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { SegmentedControl } from "./SegmentedControl";
import { ToggleSwitch } from "./ToggleSwitch";
import { SettingsTextInput } from "./SettingsTextInput";
import { CATEGORIES, SETTINGS_REGISTRY, groupByCategory, type Category, type SettingEntry } from "../lib/settingsRegistry";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

function setPref<K extends keyof PreferencesState>(
  storeField: K,
  jsonKey: string,
  value: PreferencesState[K],
) {
  const prev = usePreferencesStore.getState()[storeField];
  usePreferencesStore.setState({ [storeField]: value });
  setPreference(jsonKey, value).catch(() => {
    usePreferencesStore.setState({ [storeField]: prev });
  });
}

function renderControl(
  entry: SettingEntry,
  prefs: Record<string, unknown>,
  localTextValues: Record<string, string>,
  setLocalTextValues: React.Dispatch<React.SetStateAction<Record<string, string>>>,
) {
  switch (entry.controlType) {
    case "toggle":
      return (
        <ToggleSwitch
          key={entry.storeField}
          label={entry.label}
          testId={entry.testId}
          checked={prefs[entry.storeField] as boolean}
          onChange={(v) => setPref(entry.storeField as keyof PreferencesState, entry.jsonKey, v as never)}
        />
      );
    case "segmented":
      return (
        <SegmentedControl
          key={entry.storeField}
          label={entry.label}
          testId={entry.testId}
          value={prefs[entry.storeField] as string}
          options={entry.options!}
          onChange={(v) => setPref(entry.storeField as keyof PreferencesState, entry.jsonKey, v as never)}
        />
      );
    case "text":
      return (
        <SettingsTextInput
          key={entry.storeField}
          label={entry.label}
          testId={entry.testId}
          value={localTextValues[entry.storeField] ?? ""}
          onChange={(v) => setLocalTextValues((prev) => ({ ...prev, [entry.storeField]: v }))}
          onCommit={() => {
            const raw = localTextValues[entry.storeField] ?? "";
            // nullable: empty → null; all text fields trim on commit
            const val = entry.nullable && raw.trim() === "" ? null : raw.trim();
            setPref(entry.storeField as keyof PreferencesState, entry.jsonKey, val as never);
          }}
        />
      );
  }
}

const textEntries = SETTINGS_REGISTRY.filter((e) => e.controlType === "text");

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const prefs = usePreferencesStore(useShallow((s) => ({
    darkMode: s.darkMode,
    colorTheme: s.colorTheme,
    sidebarVisible: s.sidebarVisible,
    sidebarLocation: s.sidebarLocation,
    foldingEnabled: s.foldingEnabled,
    foldingShowControls: s.foldingShowControls,
    mediaThumbnails: s.mediaThumbnails,
    crossrefEnabled: s.crossrefEnabled,
    crossrefLiveRendering: s.crossrefLiveRendering,
    crossrefEnableCiteproc: s.crossrefEnableCiteproc,
    annotationEnabled: s.annotationEnabled,
    annotationScopeHighlight: s.annotationScopeHighlight,
    annotationDefaultLang: s.annotationDefaultLang,
    annotationDisplayMode: s.annotationDisplayMode,
    experimentalUnlinkedReferences: s.experimentalUnlinkedReferences,
  })));

  const dialogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useFocusTrap(dialogRef, open);

  const [activeCategory, setActiveCategory] = useState<Category>(CATEGORIES[0]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (open) searchInputRef.current?.focus();
  }, [open]);

  const [localTextValues, setLocalTextValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const e of textEntries) {
      const v = prefs[e.storeField];
      init[e.storeField] = v == null ? "" : String(v);
    }
    return init;
  });

  const textSyncKey = textEntries.map((e) => prefs[e.storeField]).join("\0");

  useEffect(() => {
    setLocalTextValues((prev) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const e of textEntries) {
        const v = prefs[e.storeField];
        const synced = v == null ? "" : String(v);
        next[e.storeField] = synced;
        if (synced !== prev[e.storeField]) changed = true;
      }
      return changed ? next : prev;
    });
  }, [textSyncKey]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="settings-modal-backdrop"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="rounded-lg bg-bg-primary w-[48rem] max-h-[80vh] flex flex-col"
        data-testid="settings-modal-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold text-text-normal">Settings</h2>
          <button
            className="rounded p-1 text-text-muted hover:bg-bg-secondary"
            onClick={onClose}
            data-testid="settings-modal-close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="px-5 pb-2">
          <input
            ref={searchInputRef}
            data-testid="settings-search"
            type="text"
            placeholder="Search settings…"
            className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal placeholder:text-text-muted outline-none focus:border-accent"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div data-testid="settings-modal-content" className="flex-1 overflow-y-auto flex flex-row">
          <nav data-testid="settings-sidebar" className="flex flex-col gap-1 px-3 pb-5 shrink-0 w-40">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                role="tab"
                aria-selected={cat === activeCategory}
                className={`text-left px-2 py-1 rounded text-sm ${cat === activeCategory ? "bg-bg-secondary text-text-normal" : "text-text-muted hover:bg-bg-secondary"}`}
                onClick={() => {
                  setActiveCategory(cat);
                  const section = document.getElementById(`settings-section-${cat}`);
                  section?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {cat}
              </button>
            ))}
          </nav>
          <div className="flex-1 overflow-y-auto px-5 pb-5">
            {Array.from(groupByCategory(SETTINGS_REGISTRY)).map(([cat, entries], i) => (
              <section key={cat} id={`settings-section-${cat}`} className={i > 0 ? "mt-5" : undefined}>
                <h3 className="text-sm font-medium text-text-muted mb-3">{cat}</h3>
                <div className="space-y-3">
                  {entries.map((entry) => renderControl(entry, prefs, localTextValues, setLocalTextValues))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
