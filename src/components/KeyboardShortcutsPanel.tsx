import { useState, useEffect, useMemo, useCallback, memo } from "react";
import { fetchCommandBindingTable, type CommandBindingEntry } from "../lib/commandBindingTable";
import { KeyChord } from "./KeyChord";
import { fuzzyMatch } from "../lib/fuzzyMatch";
import { formatChordSequence, type Platform } from "../lib/keyChordFormat";
import { HighlightedText } from "./HighlightedText";
import { ToggleSwitch } from "./ToggleSwitch";
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

export function KeyboardShortcutsPanel({ platform }: KeyboardShortcutsPanelProps) {
  const resolvedPlatform: Platform = platform ?? "mac";
  const [entries, setEntries] = useState<CommandBindingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showUnbound, setShowUnbound] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (filter) setCollapsed(new Set());
  }, [filter]);

  useEffect(() => {
    let cancelled = false;
    fetchCommandBindingTable()
      .then((result) => {
        if (cancelled) return;
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
      </div>

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
}: {
  group: string;
  entries: FilteredEntry[];
  platform: Platform;
  isCollapsed: boolean;
  onToggleCollapse: (group: string) => void;
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
        <EntryRow key={fe.entry.commandId} entry={fe.entry} labelIndices={fe.labelIndices} platform={platform} />
      ))}
    </>
  );
});

function EntryRow({ entry, labelIndices, platform }: { entry: CommandBindingEntry; labelIndices: number[]; platform: Platform }) {
  const label = entry.command?.label ?? entry.commandId;
  const source = getSourceBadge(entry.bindings);
  const whenContexts = [...new Set(entry.bindings.map((b) => b.when).filter(Boolean))];

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
      <td className="py-1.5 pr-3">
        {entry.bindings.length === 0 ? (
          <KeyChord chord="" platform={platform} />
        ) : (
          <span className="inline-flex flex-wrap gap-1">
            {entry.bindings.map((b, i) => (
              <KeyChord key={i} chord={b.key} platform={platform} />
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
