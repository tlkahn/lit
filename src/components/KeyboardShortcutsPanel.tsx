import { useState, useEffect, useMemo } from "react";
import { fetchCommandBindingTable, type CommandBindingEntry } from "../lib/commandBindingTable";
import { KeyChord } from "./KeyChord";
import { fuzzyMatch } from "../lib/fuzzyMatch";
import type { Platform } from "../lib/keyChordFormat";
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

function matchesFilter(entry: CommandBindingEntry, query: string): boolean {
  const label = entry.command?.label ?? entry.commandId;
  if (fuzzyMatch(query, label)) return true;
  if (fuzzyMatch(query, entry.commandId)) return true;
  const keywords = entry.command?.keywords ?? [];
  for (const kw of keywords) {
    if (fuzzyMatch(query, kw)) return true;
  }
  return false;
}

export function KeyboardShortcutsPanel({ platform }: KeyboardShortcutsPanelProps) {
  const [entries, setEntries] = useState<CommandBindingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  const filtered = useMemo(() => {
    if (!filter) return entries;
    return entries.filter((e) => matchesFilter(e, filter));
  }, [entries, filter]);

  const grouped = useMemo(() => {
    const groups = new Map<string, CommandBindingEntry[]>();
    for (const entry of filtered) {
      const group = getCommandGroup(entry.commandId);
      const list = groups.get(group);
      if (list) list.push(entry);
      else groups.set(group, [entry]);
    }
    return groups;
  }, [filtered]);

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
      <div className="px-1 pb-3">
        <input
          data-testid="shortcuts-filter"
          type="text"
          placeholder="Filter shortcuts…"
          className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal placeholder:text-text-muted outline-none focus:border-accent"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
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
                <GroupRows key={group} group={group} entries={groupEntries} platform={platform} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GroupRows({ group, entries, platform }: { group: string; entries: CommandBindingEntry[]; platform?: Platform }) {
  return (
    <>
      <tr>
        <td colSpan={4} className="pt-4 pb-1">
          <span data-testid="group-header" className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            {group}
          </span>
        </td>
      </tr>
      {entries.map((entry) => (
        <EntryRow key={entry.commandId} entry={entry} platform={platform} />
      ))}
    </>
  );
}

function EntryRow({ entry, platform }: { entry: CommandBindingEntry; platform?: Platform }) {
  const label = entry.command?.label;
  const source = getSourceBadge(entry.bindings);
  const whenContexts = [...new Set(entry.bindings.map((b) => b.when).filter(Boolean))];

  return (
    <tr className="border-b border-border/50">
      <td className="py-1.5 pr-3">
        {entry.status === "unknown-command" ? (
          <em className="text-text-muted">{entry.commandId}</em>
        ) : (
          <span>{label ?? entry.commandId}</span>
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
