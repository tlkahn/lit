import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import { fetchCommandBindingTable, type CommandBindingEntry } from "../lib/commandBindingTable";
import { KeyChord } from "./KeyChord";
import { KeyRecorder } from "./KeyRecorder";
import { ConflictResolutionDialog } from "./ConflictResolutionDialog";
import { fuzzyMatch } from "../lib/fuzzyMatch";
import { formatChordSequence, type Platform } from "../lib/keyChordFormat";
import { HighlightedText } from "./HighlightedText";
import { ToggleSwitch } from "./ToggleSwitch";
import { detectConflicts, applyRebind } from "../lib/conflictDetection";
import { computeKeymapDiff } from "../lib/keymapDiff";
import { getDefaultKeymaps, saveUserKeymaps } from "../lib/ipc";
import type { ConflictEntry } from "../lib/conflictDetection";
import type { KeyBinding } from "../lib/ipc";

interface KeyboardShortcutsPanelProps {
  platform?: Platform;
}

function getSourceBadge(bindings: KeyBinding[]) {
  const sources = new Set(bindings.map((b) => b.source).filter(Boolean));
  if (sources.has("user")) return "user";
  if (sources.has("menu")) return "menu";
  if (sources.has("default")) return "default";
  return null;
}

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return null;

  const styles: Record<string, string> = {
    default: "text-text-muted bg-bg-secondary",
    user: "text-accent bg-bg-secondary",
    menu: "text-text-muted bg-bg-secondary border border-border",
  };

  const labels: Record<string, string> = {
    default: "Default",
    user: "User",
    menu: "Menu",
  };

  return (
    <span
      data-testid="source-badge"
      className={`inline-block rounded px-1.5 py-0.5 text-xs ${styles[source] ?? ""}`}
    >
      {labels[source] ?? source}
    </span>
  );
}

function getCommandGroup(commandId: string): string {
  const dotIdx = commandId.indexOf(".");
  return dotIdx >= 0 ? commandId.slice(0, dotIdx) : "other";
}

interface FilterMatch {
  matches: boolean;
  labelIndices: number[];
}

function getFilterMatch(entry: CommandBindingEntry, query: string, platform: Platform): FilterMatch {
  const label = entry.command?.label ?? entry.commandId;

  const labelMatch = fuzzyMatch(query, label);
  if (labelMatch) return { matches: true, labelIndices: labelMatch.indices };

  if (fuzzyMatch(query, entry.commandId)) return { matches: true, labelIndices: [] };

  const keywords = entry.command?.keywords ?? [];
  for (const kw of keywords) {
    if (fuzzyMatch(query, kw)) return { matches: true, labelIndices: [] };
  }

  for (const b of entry.bindings) {
    const formatted = formatChordSequence(b.key, platform);
    if (fuzzyMatch(query, formatted)) return { matches: true, labelIndices: [] };
    if (fuzzyMatch(query, b.key)) return { matches: true, labelIndices: [] };
  }

  return { matches: false, labelIndices: [] };
}

interface FilteredEntry {
  entry: CommandBindingEntry;
  labelIndices: number[];
}

interface EditingState {
  commandId: string;
  bindingIndex: number;
}

interface ConflictDialogState {
  newKey: string;
  newWhen: string | undefined;
  command: string;
  commandLabel: string;
  conflicts: ConflictEntry[];
  bindingIndex: number;
}

export function KeyboardShortcutsPanel({ platform }: KeyboardShortcutsPanelProps) {
  const resolvedPlatform: Platform = platform ?? "mac";
  const [entries, setEntries] = useState<CommandBindingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showUnbound, setShowUnbound] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [conflictDialog, setConflictDialog] = useState<ConflictDialogState | null>(null);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const defaultsRef = useRef<KeyBinding[]>([]);

  const [saveError, setSaveError] = useState<string | null>(null);

  const persistAndReload = useCallback(async (updatedEntries: CommandBindingEntry[]) => {
    const allCurrent = updatedEntries.flatMap((e) => e.bindings);
    const diff = computeKeymapDiff(allCurrent, defaultsRef.current);
    await saveUserKeymaps(diff);
    setSaveError(null);
    window.dispatchEvent(new CustomEvent("lit:keymaps-changed"));
  }, []);

  useEffect(() => {
    if (filter) setCollapsed(new Set());
  }, [filter]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCommandBindingTable(), getDefaultKeymaps()])
      .then(([result, defaults]) => {
        if (cancelled) return;
        defaultsRef.current = defaults;
        setEntries(result);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo((): FilteredEntry[] => {
    let base = entries;
    if (!showUnbound) {
      base = base.filter((e) => e.status !== "unbound");
    }
    if (!filter) return base.map((e) => ({ entry: e, labelIndices: [] }));
    const result: FilteredEntry[] = [];
    for (const e of base) {
      const match = getFilterMatch(e, filter, resolvedPlatform);
      if (match.matches) {
        result.push({ entry: e, labelIndices: match.labelIndices });
      }
    }
    return result;
  }, [entries, filter, showUnbound, resolvedPlatform]);

  const grouped = useMemo(() => {
    const groups = new Map<string, FilteredEntry[]>();
    for (const fe of filtered) {
      const group = getCommandGroup(fe.entry.commandId);
      const list = groups.get(group);
      if (list) list.push(fe);
      else groups.set(group, [fe]);
    }
    return groups;
  }, [filtered]);

  const toggleCollapse = useCallback((group: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const allBindings = useMemo(
    () => entries.flatMap((e) => e.bindings),
    [entries],
  );

  const handleStartEdit = useCallback((commandId: string, bindingIndex: number) => {
    setEditing({ commandId, bindingIndex });
  }, []);

  const handleConfirmKey = useCallback((commandId: string, notation: string, when: string | undefined, bindingIndex: number) => {
    const commandLabel = entries.find((e) => e.commandId === commandId)?.command?.label ?? commandId;
    const conflictBindings = detectConflicts(notation, when, allBindings, commandId);

    if (conflictBindings.length === 0) {
      const updatedEntries = entries.map((e) => {
        if (e.commandId !== commandId) return e;
        const newBinding: KeyBinding = { command: commandId, key: notation, when, source: "user" };
        let newBindings: KeyBinding[];
        if (bindingIndex >= 0 && bindingIndex < e.bindings.length) {
          newBindings = e.bindings.map((b, i) => i === bindingIndex ? newBinding : b);
        } else {
          newBindings = [...e.bindings, newBinding];
        }
        return { ...e, bindings: newBindings, status: "bound" as const };
      });
      setEntries(updatedEntries);
      persistAndReload(updatedEntries).catch((err) => setSaveError(err instanceof Error ? err.message : String(err)));
    } else {
      const conflicts: ConflictEntry[] = conflictBindings.map((b) => ({
        binding: b,
        label: entries.find((e) => e.commandId === b.command)?.command?.label ?? b.command,
      }));
      setConflictDialog({ newKey: notation, newWhen: when, command: commandId, commandLabel, conflicts, bindingIndex });
    }
    setEditing(null);
  }, [entries, allBindings, persistAndReload]);

  const handleCancelEdit = useCallback(() => {
    setEditing(null);
  }, []);

  const handleRebind = useCallback(() => {
    if (!conflictDialog) return;
    const { newKey, newWhen, command, conflicts, bindingIndex } = conflictDialog;
    const conflictBindings = conflicts.map((c) => c.binding);
    const bindingsWithSlotRemoved = allBindings.filter((b, _i) => {
      if (b.command !== command) return true;
      const entry = entries.find((e) => e.commandId === command);
      if (!entry) return true;
      const idx = entry.bindings.indexOf(b);
      return idx !== bindingIndex;
    });
    const updatedBindings = applyRebind(bindingsWithSlotRemoved, newKey, command, newWhen, conflictBindings);

    const updatedEntries = entries.map((e) => {
      const myBindings = updatedBindings.filter((b) => b.command === e.commandId);
      return {
        ...e,
        bindings: myBindings,
        status: myBindings.length > 0 ? "bound" as const : "unbound" as const,
      };
    });
    setEntries(updatedEntries);
    persistAndReload(updatedEntries).catch((err) => setSaveError(err instanceof Error ? err.message : String(err)));
    setConflictDialog(null);
  }, [conflictDialog, allBindings, entries, persistAndReload]);

  const handleResetBinding = useCallback((commandId: string, bindingIndex: number) => {
    const entry = entries.find((e) => e.commandId === commandId);
    if (!entry) return;
    const binding = entry.bindings[bindingIndex];
    if (!binding) return;

    const defaultBinding = defaultsRef.current.find(
      (d) => d.command === commandId && (d.when ?? "") === (binding.when ?? ""),
    );

    let updatedEntries: CommandBindingEntry[];
    if (defaultBinding) {
      updatedEntries = entries.map((e) => {
        if (e.commandId !== commandId) return e;
        const newBindings = e.bindings.map((b, i) =>
          i === bindingIndex ? { ...defaultBinding } : b,
        );
        return { ...e, bindings: newBindings };
      });
    } else {
      updatedEntries = entries.map((e) => {
        if (e.commandId !== commandId) return e;
        const newBindings = e.bindings.filter((_, i) => i !== bindingIndex);
        return {
          ...e,
          bindings: newBindings,
          status: newBindings.length > 0 ? "bound" as const : "unbound" as const,
        };
      });
    }
    setEntries(updatedEntries);
    persistAndReload(updatedEntries).catch((err) => setSaveError(err instanceof Error ? err.message : String(err)));
  }, [entries, persistAndReload]);

  const handleResetAll = useCallback(async () => {
    await saveUserKeymaps([]);
    window.dispatchEvent(new CustomEvent("lit:keymaps-changed"));
    const result = await fetchCommandBindingTable();
    setEntries(result);
    setResetAllOpen(false);
  }, []);

  const handleCancelConflict = useCallback(() => {
    setConflictDialog(null);
  }, []);

  if (loading) {
    return (
      <div data-testid="shortcuts-loading" className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="shortcuts-error" className="py-8 text-center text-sm text-red-500">
        Failed to load shortcuts
      </div>
    );
  }

  return (
    <div data-testid="keyboard-shortcuts-panel" className="flex flex-col h-full">
      <div className="px-1 pb-3 flex items-center gap-3">
        <input
          data-testid="shortcuts-filter"
          type="text"
          placeholder="Filter shortcuts…"
          className="flex-1 rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal placeholder:text-text-muted outline-none focus:border-accent"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <ToggleSwitch
          checked={showUnbound}
          onChange={setShowUnbound}
          testId="show-unbound-toggle"
          label="Show unbound commands"
        />
        <button
          data-testid="reset-all-btn"
          className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text-normal"
          onClick={() => setResetAllOpen(true)}
        >
          Reset All
        </button>
      </div>

      {resetAllOpen && (
        <div data-testid="reset-all-dialog" className="mb-3 mx-1 rounded border border-border bg-bg-secondary p-3 text-sm">
          <p className="mb-2">Reset all shortcuts to defaults? This cannot be undone.</p>
          <div className="flex gap-2">
            <button
              data-testid="reset-all-confirm-btn"
              className="rounded bg-accent px-2 py-1 text-xs text-white"
              onClick={handleResetAll}
            >
              Confirm
            </button>
            <button
              data-testid="reset-all-cancel-btn"
              className="rounded border border-border px-2 py-1 text-xs"
              onClick={() => setResetAllOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {saveError && (
        <div data-testid="save-error" className="mb-2 mx-1 rounded border border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-700">
          {saveError}
        </div>
      )}

      <ConflictResolutionDialog
        open={conflictDialog !== null}
        newKey={conflictDialog?.newKey ?? ""}
        newCommandLabel={conflictDialog?.commandLabel ?? ""}
        conflicts={conflictDialog?.conflicts ?? []}
        platform={resolvedPlatform}
        onRebind={handleRebind}
        onCancel={handleCancelConflict}
      />

      {filtered.length === 0 ? (
        <div className="py-8 text-center text-sm text-text-muted">No matching shortcuts</div>
      ) : (
        <div className="overflow-y-auto flex-1">
          <table data-testid="keyboard-shortcuts-table" className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-border">
                <th className="pb-2 font-medium">Command</th>
                <th className="pb-2 font-medium">Keybinding</th>
                <th className="pb-2 font-medium">Source</th>
                <th className="pb-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(grouped).map(([group, groupEntries]) => (
                <GroupRows
                  key={group}
                  group={group}
                  entries={groupEntries}
                  platform={resolvedPlatform}
                  isCollapsed={!filter && collapsed.has(group)}
                  onToggleCollapse={toggleCollapse}
                  editing={editing}
                  onStartEdit={handleStartEdit}
                  onConfirmKey={handleConfirmKey}
                  onCancelEdit={handleCancelEdit}
                  onResetBinding={handleResetBinding}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const GroupRows = memo(function GroupRows({
  group,
  entries,
  platform,
  isCollapsed,
  onToggleCollapse,
  editing,
  onStartEdit,
  onConfirmKey,
  onCancelEdit,
  onResetBinding,
}: {
  group: string;
  entries: FilteredEntry[];
  platform: Platform;
  isCollapsed: boolean;
  onToggleCollapse: (group: string) => void;
  editing: EditingState | null;
  onStartEdit: (commandId: string, bindingIndex: number) => void;
  onConfirmKey: (commandId: string, notation: string, when: string | undefined, bindingIndex: number) => void;
  onCancelEdit: () => void;
  onResetBinding: (commandId: string, bindingIndex: number) => void;
}) {
  return (
    <>
      <tr>
        <td colSpan={4} className="pt-4 pb-1">
          <button
            aria-expanded={!isCollapsed}
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${group} group`}
            className="flex items-center gap-1 text-xs font-semibold text-text-muted uppercase tracking-wide cursor-pointer"
            onClick={() => onToggleCollapse(group)}
          >
            <span data-testid="collapse-indicator" className="text-[10px]">
              {isCollapsed ? "▶" : "▼"}
            </span>
            <span data-testid="group-header">{group}</span>
          </button>
        </td>
      </tr>
      {!isCollapsed && entries.map((fe) => (
        <EntryRow
          key={fe.entry.commandId}
          entry={fe.entry}
          labelIndices={fe.labelIndices}
          platform={platform}
          editing={editing?.commandId === fe.entry.commandId ? editing : null}
          onStartEdit={onStartEdit}
          onConfirmKey={onConfirmKey}
          onCancelEdit={onCancelEdit}
          onResetBinding={onResetBinding}
        />
      ))}
    </>
  );
});

function EntryRow({
  entry,
  labelIndices,
  platform,
  editing,
  onStartEdit,
  onConfirmKey,
  onCancelEdit,
  onResetBinding,
}: {
  entry: CommandBindingEntry;
  labelIndices: number[];
  platform: Platform;
  editing: EditingState | null;
  onStartEdit: (commandId: string, bindingIndex: number) => void;
  onConfirmKey: (commandId: string, notation: string, when: string | undefined, bindingIndex: number) => void;
  onCancelEdit: () => void;
  onResetBinding: (commandId: string, bindingIndex: number) => void;
}) {
  const label = entry.command?.label ?? entry.commandId;
  const source = getSourceBadge(entry.bindings);
  const whenContexts = [...new Set(entry.bindings.map((b) => b.when).filter(Boolean))];

  const isEditing = editing !== null;
  const editingIndex = editing?.bindingIndex ?? -1;
  const editingBinding = editingIndex >= 0 && editingIndex < entry.bindings.length
    ? entry.bindings[editingIndex]
    : undefined;

  return (
    <tr className="border-b border-border/50">
      <td className="py-1.5 pr-3">
        {entry.status === "unknown-command" ? (
          <em className="text-text-muted">{entry.commandId}</em>
        ) : labelIndices.length > 0 ? (
          <HighlightedText text={label} indices={labelIndices} />
        ) : (
          <span>{label}</span>
        )}
      </td>
      <td
        className="py-1.5 pr-3 cursor-pointer"
        onClick={() => !isEditing && entry.bindings.length === 0 && onStartEdit(entry.commandId, entry.bindings.length)}
      >
        {isEditing ? (
          <KeyRecorder
            platform={platform}
            value={editingBinding?.key}
            onConfirm={(notation) => onConfirmKey(entry.commandId, notation, editingBinding?.when, editingIndex)}
            onCancel={onCancelEdit}
          />
        ) : entry.bindings.length === 0 ? (
          <KeyChord chord="" platform={platform} />
        ) : (
          <span className="inline-flex flex-wrap gap-1 items-center">
            {entry.bindings.map((b, i) => (
              <span key={i} className="inline-flex items-center gap-0.5">
                <span onClick={(e) => { e.stopPropagation(); onStartEdit(entry.commandId, i); }}>
                  <KeyChord chord={b.key} platform={platform} />
                </span>
                {b.source === "user" && (
                  <button
                    data-testid="reset-binding-btn"
                    className="text-text-muted hover:text-text-normal text-xs"
                    onClick={(e) => { e.stopPropagation(); onResetBinding(entry.commandId, i); }}
                    title="Reset to default"
                  >
                    ↺
                  </button>
                )}
              </span>
            ))}
          </span>
        )}
      </td>
      <td className="py-1.5 pr-3">
        <SourceBadge source={source} />
      </td>
      <td className="py-1.5 text-text-muted text-xs">
        {whenContexts.join(", ")}
      </td>
    </tr>
  );
}
