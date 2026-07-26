import { useEffect, useCallback, useRef, useState, useMemo } from "react";
import { flushSync } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { usePreferencesStore, type PreferencesState } from "../stores/preferences";
import { useThemeStore } from "../stores/theme";
import { setPreference, getPreferencesRaw, setPreferencesRaw, setApiKey, deleteApiKey, hasApiKey } from "../lib/ipc";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { SegmentedControl } from "./SegmentedControl";
import { ToggleSwitch } from "./ToggleSwitch";
import { SettingsTextInput } from "./SettingsTextInput";
import { SettingsDropdown } from "./SettingsDropdown";
import { SettingsPasswordInput } from "./SettingsPasswordInput";
import { SettingsTextArea } from "./SettingsTextArea";
import { SettingsSlider } from "./SettingsSlider";
import { HighlightedText } from "./HighlightedText";
import { SettingsJsonEditor } from "./SettingsJsonEditor";
import { CATEGORIES, SETTINGS_REGISTRY, STORE_FIELDS, filterSettings, type Category, type SettingEntry, type FilteredSetting, type PreferenceField, type PasswordEntry } from "../lib/settingsRegistry";
import { KeyboardShortcutsPanel } from "./KeyboardShortcutsPanel";
import { AcademicExportSettings } from "./AcademicExportSettings";
import { LlmProviderSettings } from "./LlmProviderSettings";
import { CompanionSearchPathSettings } from "./CompanionSearchPathSettings";
import { SearchProviderSettings } from "./SearchProviderSettings";
import { FontSettings } from "./FontSettings";
import { useSecretStoreStore } from "../stores/secretStore";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialCategory?: Category;
}

function setRegistryPref(storeField: PreferenceField, jsonKey: string, value: unknown) {
  const prev = usePreferencesStore.getState()[storeField];
  usePreferencesStore.setState({ [storeField]: value } as Partial<PreferencesState>);
  setPreference(jsonKey, value).catch(() => {
    // Only revert if the optimistic value is still current - a stale revert
    // would clobber a newer write (same pattern as setFontList et al.).
    usePreferencesStore.setState((state) =>
      state[storeField] === value ? ({ [storeField]: prev } as Partial<PreferencesState>) : {},
    );
  });
}

interface RenderControlParams {
  entry: SettingEntry;
  prefs: Record<string, unknown>;
  localTextValues: Record<string, string>;
  setLocalTextValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  matchIndices: number[];
  ensureUnlocked: () => Promise<void>;
  dynamicOptions: Record<string, { value: string; label: string }[]>;
}

function renderControl(params: RenderControlParams) {
  const { entry, prefs, localTextValues, setLocalTextValues, matchIndices } = params;
  const label = matchIndices.length > 0
    ? <HighlightedText text={entry.label} indices={matchIndices} />
    : entry.label;

  switch (entry.controlType) {
    case "toggle":
      return (
        <ToggleSwitch
          key={entry.storeField}
          label={label}
          testId={entry.testId}
          checked={prefs[entry.storeField] as boolean}
          onChange={(v) => setRegistryPref(entry.storeField, entry.jsonKey, v)}
        />
      );
    case "segmented":
      return (
        <SegmentedControl
          key={entry.storeField}
          label={label}
          testId={entry.testId}
          value={prefs[entry.storeField] as string}
          options={entry.options}
          onChange={(v) => setRegistryPref(entry.storeField, entry.jsonKey, v)}
        />
      );
    case "text":
      return (
        <SettingsTextInput
          key={entry.storeField}
          label={label}
          testId={entry.testId}
          value={localTextValues[entry.storeField] ?? ""}
          onChange={(v) => setLocalTextValues((prev) => ({ ...prev, [entry.storeField]: v }))}
          onCommit={() => {
            const raw = localTextValues[entry.storeField] ?? "";
            const trimmed = raw.trim();
            const val = entry.nullable && trimmed === "" ? null : entry.normalize?.(trimmed) ?? trimmed;
            setRegistryPref(entry.storeField, entry.jsonKey, val);
          }}
          hint={entry.hint}
        />
      );
    case "dropdown": {
      const opts = params.dynamicOptions[entry.storeField] ?? entry.options ?? [];
      const raw = prefs[entry.storeField];
      const value = raw == null ? "" : String(raw);
      return (
        <SettingsDropdown
          key={entry.storeField}
          label={label}
          testId={entry.testId}
          options={opts}
          value={value}
          nullable={entry.nullable}
          onChange={(v) => {
            const val = entry.nullable && v === "" ? null : v;
            setRegistryPref(entry.storeField, entry.jsonKey, val);
          }}
        />
      );
    }
    case "password":
      return (
        <SettingsPasswordInput
          key={entry.storeField}
          label={label}
          testId={entry.testId}
          hasKey={prefs[entry.storeField] as boolean}
          onSave={(v) => {
            params.ensureUnlocked().then(() => {
              usePreferencesStore.setState({ [entry.storeField]: true } as Partial<PreferencesState>);
              setApiKey(entry.provider, v).catch(() => {
                usePreferencesStore.setState({ [entry.storeField]: false } as Partial<PreferencesState>);
              });
            }).catch(() => {
              // User cancelled passphrase entry — abort save
            });
          }}
          onDelete={() => {
            params.ensureUnlocked().then(() => {
              usePreferencesStore.setState({ [entry.storeField]: false } as Partial<PreferencesState>);
              deleteApiKey(entry.provider).catch(() => {
                usePreferencesStore.setState({ [entry.storeField]: true } as Partial<PreferencesState>);
              });
            }).catch(() => {
              // User cancelled passphrase entry — abort delete
            });
          }}
        />
      );
    case "textarea":
      return (
        <SettingsTextArea
          key={entry.storeField}
          label={label}
          testId={entry.testId}
          value={localTextValues[entry.storeField] ?? ""}
          onChange={(v) => setLocalTextValues((prev) => ({ ...prev, [entry.storeField]: v }))}
          onCommit={() => {
            const raw = localTextValues[entry.storeField] ?? "";
            const val = entry.nullable && raw.trim() === "" ? null : raw;
            setRegistryPref(entry.storeField, entry.jsonKey, val);
          }}
        />
      );
    case "slider":
      return (
        <SettingsSlider
          key={entry.storeField}
          label={label}
          testId={entry.testId}
          value={prefs[entry.storeField] as number}
          min={entry.min}
          max={entry.max}
          step={entry.step}
          onChange={(v) => setRegistryPref(entry.storeField, entry.jsonKey, v)}
        />
      );
    case "custom":
      // A dedicated component (e.g. LlmProviderSettings) owns the real UI; this
      // entry is a search-only anchor and renders nothing here.
      return null;
  }
}

const textEntries = SETTINGS_REGISTRY.filter((e) => e.controlType === "text" || e.controlType === "textarea");

export function SettingsModal({ open, onClose, initialCategory }: SettingsModalProps) {
  const prefs = usePreferencesStore(useShallow((s) => {
    const obj: Record<string, unknown> = {};
    for (const f of STORE_FIELDS) obj[f] = s[f];
    return obj;
  }));

  const availableThemes = useThemeStore((s) => s.availableThemes);
  const dynamicOptions = useMemo(() => ({
    colorTheme: availableThemes.map((t) => ({ value: t.directory_name, label: t.name })),
  }), [availableThemes]);

  const ensureUnlocked = useSecretStoreStore((s) => s.ensureUnlocked);
  const exists = useSecretStoreStore((s) => s.exists);
  const unlocked = useSecretStoreStore((s) => s.unlocked);

  useEffect(() => {
    if (!open) return;
    // A locked-but-existing store makes hasApiKey() return false for every
    // provider, which would wrongly clobber the saved-key flags to "not saved".
    // Skip the check until the store is unlocked (migration completed); the
    // effect re-runs once `unlocked` flips. A non-existent store (exists=false)
    // is a fresh user with no keys, so running the check is correct there.
    if (exists && !unlocked) return;
    const currentProvider = usePreferencesStore.getState().llmProvider;
    hasApiKey(currentProvider.providerId).then((has) => {
      usePreferencesStore.setState((prev) => {
        // Guard against a stale result: if the user switched providers between
        // when this check fired and when it resolved, don't clobber the new
        // provider's flag with the old provider's `has` value.
        if (prev.llmProvider.providerId !== currentProvider.providerId) return prev;
        // No-op when the flag already matches - avoid fabricating a fresh
        // llmProvider object (and a store update) per resolution.
        if (prev.llmProvider.apiKeySet === has) return prev;
        return { llmProvider: { ...prev.llmProvider, apiKeySet: has } };
      });
    });
    // Reconcile paper-search API key flags against the credential store.
    const searchKeyChecks = SETTINGS_REGISTRY
      .filter((e): e is PasswordEntry => e.controlType === "password" && e.category === "Paper Search")
      .map(e => ({ provider: e.provider, field: e.storeField as keyof PreferencesState }));
    for (const { provider, field } of searchKeyChecks) {
      hasApiKey(provider).then((has) => {
        usePreferencesStore.setState({ [field]: has } as Partial<PreferencesState>);
      }).catch(() => {});
    }
  }, [open, exists, unlocked]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useFocusTrap(dialogRef, open);

  const [activeCategory, setActiveCategory] = useState<Category>(CATEGORIES[0]);
  const [searchQuery, setSearchQuery] = useState("");
  const [jsonMode, setJsonMode] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const filteredResults = useMemo(
    () => filterSettings(SETTINGS_REGISTRY, searchQuery),
    [searchQuery],
  );

  const filteredGroups = useMemo(() => {
    const groups = new Map<Category, FilteredSetting[]>();
    for (const cat of CATEGORIES) groups.set(cat, []);
    for (const result of filteredResults) groups.get(result.entry.category)!.push(result);
    return groups;
  }, [filteredResults]);

  const matchedCategories = useMemo(() => {
    if (searchQuery === "") return null;
    const matched = new Set<Category>();
    for (const [cat, results] of filteredGroups) {
      if (results.length > 0) matched.add(cat);
    }
    return matched;
  }, [searchQuery, filteredGroups]);

  const prevOpenRef = useRef(false);

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setSearchQuery("");
      setJsonMode(false);
      setActiveCategory(initialCategory ?? CATEGORIES[0]);
      searchInputRef.current?.focus();
    }
    prevOpenRef.current = open;
  }, [open, initialCategory]);

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
      if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  const handleToggleJsonMode = useCallback(async () => {
    if (!jsonMode) {
      try {
        const raw = await getPreferencesRaw();
        setRawJson(raw);
        setJsonError(null);
        setJsonMode(true);
      } catch (e) {
        setJsonError(e instanceof Error ? e.message : String(e));
      }
    } else {
      setJsonMode(false);
    }
  }, [jsonMode]);

  const handleJsonSave = useCallback(async (json: string) => {
    try {
      await setPreferencesRaw(json);
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : String(e));
    }
  }, []);

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
        {!jsonMode && activeCategory !== "Keyboard Shortcuts" && (
          <div className="order-2 px-5 pb-2">
            <input
              ref={searchInputRef}
              data-testid="settings-search"
              type="text"
              placeholder="Search settings…"
              className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal placeholder:text-text-muted outline-none focus:border-accent"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && searchQuery !== "") {
                  e.preventDefault();
                  e.stopPropagation();
                  setSearchQuery("");
                }
              }}
            />
          </div>
        )}

        <div className="order-1 flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold text-text-normal">Settings</h2>
          <div className="flex items-center gap-2">
            <button
              className="rounded px-2 py-1 text-sm text-text-muted hover:bg-bg-secondary"
              onClick={handleToggleJsonMode}
              data-testid="settings-edit-json-btn"
            >
              {jsonMode ? "Form View" : "Edit JSON"}
            </button>
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
        </div>

        <div data-testid="settings-modal-content" className="order-3 flex-1 overflow-y-auto overflow-x-hidden flex flex-row">
          {jsonMode ? (
            <div className="flex-1 px-5 pb-5">
              <SettingsJsonEditor initialJson={rawJson} onSave={handleJsonSave} error={jsonError} />
            </div>
          ) : (
            <>
              <nav
                data-testid="settings-sidebar"
                role="tablist"
                aria-orientation="vertical"
                className="flex flex-col gap-1 px-3 pb-5 shrink-0 w-40"
                onKeyDown={(e) => {
                  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                  e.preventDefault();
                  const step = e.key === "ArrowDown" ? 1 : -1;
                  const len = CATEGORIES.length;
                  let idx = CATEGORIES.indexOf(activeCategory);
                  for (let i = 0; i < len - 1; i++) {
                    idx = (idx + step + len) % len;
                    if (!matchedCategories || matchedCategories.has(CATEGORIES[idx]!)) break;
                  }
                  const nextCat = CATEGORIES[idx]!;
                  setActiveCategory(nextCat);
                  const buttons = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("button");
                  buttons[idx]?.focus();
                  if (nextCat !== "Keyboard Shortcuts") {
                    const section = document.getElementById(`settings-section-${nextCat}`);
                    section?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
              >
                {CATEGORIES.map((cat) => {
                  const hasMatches = matchedCategories
                    ? cat === "Keyboard Shortcuts" ? undefined : matchedCategories.has(cat)
                    : undefined;
                  return (
                    <button
                      key={cat}
                      role="tab"
                      aria-selected={cat === activeCategory}
                      {...(hasMatches !== undefined && { "data-has-matches": String(hasMatches) })}
                      className={`text-left px-2 py-1 rounded text-sm ${cat === activeCategory ? "bg-bg-secondary text-text-normal" : "text-text-muted hover:bg-bg-secondary"} ${hasMatches === false ? "opacity-40" : ""}`}
                      onClick={() => {
                        if (cat !== "Keyboard Shortcuts" && searchQuery !== "" && matchedCategories && !matchedCategories.has(cat)) {
                          flushSync(() => setSearchQuery(""));
                        }
                        setActiveCategory(cat);
                        if (cat !== "Keyboard Shortcuts") {
                          const section = document.getElementById(`settings-section-${cat}`);
                          section?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }
                      }}
                    >
                      {cat}
                    </button>
                  );
                })}
              </nav>
              <div className="flex-1 min-w-0 overflow-y-auto px-5 pb-5">
                {activeCategory === "Keyboard Shortcuts" ? (
                  <KeyboardShortcutsPanel />
                ) : filteredResults.length === 0 && searchQuery !== "" ? (
                  <div data-testid="settings-no-results" className="py-8 text-center text-sm text-text-muted">
                    No matching settings
                  </div>
                ) : (
                  Array.from(filteredGroups)
                    .filter(([cat, results]) => cat !== "Keyboard Shortcuts" && results.length > 0)
                    .map(([cat, results], i) => {
                      const isSearching = searchQuery !== "";
                      const ungrouped = isSearching ? results : results.filter(({ entry }) => !entry.group);
                      const grouped = isSearching ? new Map<string, FilteredSetting[]>() : (() => {
                        const map = new Map<string, FilteredSetting[]>();
                        for (const r of results) {
                          if (r.entry.group) {
                            const arr = map.get(r.entry.group) ?? [];
                            arr.push(r);
                            map.set(r.entry.group, arr);
                          }
                        }
                        return map;
                      })();
                      return (
                        <section key={cat} id={`settings-section-${cat}`} className={i > 0 ? "mt-5" : undefined}>
                          <h3 className="text-sm font-medium text-text-muted mb-3">{cat}</h3>
                          {cat === "LLM" && (
                            <div className="mb-3">
                              <LlmProviderSettings ensureUnlocked={ensureUnlocked} />
                            </div>
                          )}
                          {cat === "Paper Search" && (
                            <div className="mb-3">
                              <SearchProviderSettings />
                            </div>
                          )}
                          <div className="space-y-3">
                            {ungrouped.map(({ entry, indices }) => renderControl({ entry, prefs, localTextValues, setLocalTextValues, matchIndices: indices, ensureUnlocked, dynamicOptions }))}
                          </div>
                          {cat === "Academic Export" && (
                            <div className="mt-3">
                              <AcademicExportSettings />
                            </div>
                          )}
                          {cat === "Appearance" && (
                            <div className="mt-3">
                              <FontSettings />
                            </div>
                          )}
                          {cat === "Editor" && (
                            <div className="mt-3">
                              <CompanionSearchPathSettings />
                            </div>
                          )}
                          {Array.from(grouped).map(([groupName, groupResults]) => (
                            <div key={groupName} data-testid={`settings-group-${groupName}`} className="mt-3">
                              <button
                                onClick={() => setExpandedGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }))}
                                className="flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text-normal"
                              >
                                <span className="text-xs">{expandedGroups[groupName] ? "▼" : "▶"}</span> {groupName}
                              </button>
                              {expandedGroups[groupName] && (
                                <div className="space-y-3 mt-2">
                                  {groupResults.map(({ entry, indices }) => renderControl({ entry, prefs, localTextValues, setLocalTextValues, matchIndices: indices, ensureUnlocked, dynamicOptions }))}
                                </div>
                              )}
                            </div>
                          ))}
                        </section>
                      );
                    })
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
