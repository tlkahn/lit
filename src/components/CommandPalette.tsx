import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  searchAnnotations,
  type AnnotationType,
  type AnnotationSearchResult,
} from "../lib/ipc";
import {
  TYPE_ICON,
  certaintyMark,
  truncateBody,
} from "../editor/livePreview/annotationConstants";
import { useWorkspaceStore } from "../stores/workspace";
import { globalJumpTracker } from "../editor/jumpTracker";

interface StaticCommand {
  id: string;
  label: string;
  icon: string;
  action: () => void;
}

const STATIC_COMMANDS: StaticCommand[] = [
  {
    id: "insert-annotation",
    label: "Insert Annotation",
    icon: "✏️",
    action: () => window.dispatchEvent(new CustomEvent("lit:open-annotation-builder")),
  },
];

type PaletteMode = "titles" | "annotations" | "tags" | "content";

const PREFIX_MAP: Record<string, PaletteMode> = {
  "@": "annotations",
  "#": "tags",
  "/": "content",
};

const ANNOTATION_TYPES: (AnnotationType | "all")[] = [
  "all",
  "note",
  "question",
  "todo",
  "crossref",
  "apparatus",
  "translation",
];

function parseInput(raw: string): { mode: PaletteMode; query: string; prefix: string | null } {
  const firstChar = raw.charAt(0);
  const mode = PREFIX_MAP[firstChar];
  if (mode) {
    return { mode, query: raw.slice(1), prefix: firstChar };
  }
  return { mode: "titles", query: raw, prefix: null };
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [rawInput, setRawInput] = useState("");
  const [results, setResults] = useState<AnnotationSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [typeFilter, setTypeFilter] = useState<AnnotationType | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevModeRef = useRef<PaletteMode>("titles");

  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const selectPageAtLine = useWorkspaceStore((s) => s.selectPageAtLine);

  const { mode, query, prefix } = parseInput(rawInput);

  const filteredCommands = useMemo(() => {
    if (mode !== "titles") return [];
    const q = query.toLowerCase();
    return STATIC_COMMANDS.filter((cmd) => cmd.label.toLowerCase().includes(q));
  }, [mode, query]);

  if (mode !== prevModeRef.current) {
    if (prevModeRef.current !== mode) {
      setTypeFilter(null);
    }
    prevModeRef.current = mode;
  }

  useEffect(() => {
    if (open) {
      setRawInput("");
      setResults([]);
      setActiveIndex(0);
      setTypeFilter(null);
      setHasSearched(false);
      prevModeRef.current = "titles";
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (mode !== "annotations" || !query) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setResults([]);
      setHasSearched(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      const res = await searchAnnotations(query, typeFilter ?? undefined);
      setResults(res);
      setActiveIndex(0);
      setHasSearched(true);
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [mode, query, typeFilter]);

  const totalItems = filteredCommands.length + results.length;

  useEffect(() => {
    if (totalItems === 0) return;
    const activeEl = listRef.current?.querySelector('[data-active="true"]');
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, totalItems]);

  const handleSelect = useCallback(
    (result: AnnotationSearchResult) => {
      globalJumpTracker.recordJump(
        { notePath: currentPagePath ?? "", line: 1, col: 0 },
        { notePath: result.node_id, line: result.source_line, col: 0 },
      );

      if (result.node_id === currentPagePath) {
        window.dispatchEvent(
          new CustomEvent("lit:scroll-to-line", {
            detail: { line: result.source_line, cursor: true },
          }),
        );
      } else {
        selectPageAtLine(result.node_id, result.source_line);
      }

      onClose();
    },
    [currentPagePath, selectPageAtLine, onClose],
  );

  const handleCommandSelect = useCallback(
    (cmd: StaticCommand) => {
      cmd.action();
      onClose();
    },
    [onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (totalItems > 0) {
          setActiveIndex((prev) => (prev + 1) % totalItems);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (totalItems > 0) {
          setActiveIndex((prev) => (prev - 1 + totalItems) % totalItems);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex < filteredCommands.length) {
          const cmd = filteredCommands[activeIndex];
          if (cmd) handleCommandSelect(cmd);
        } else {
          const resultIndex = activeIndex - filteredCommands.length;
          if (results[resultIndex]) {
            handleSelect(results[resultIndex]);
          }
        }
      }
    },
    [results, activeIndex, totalItems, filteredCommands, handleSelect, handleCommandSelect, onClose],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setRawInput(e.target.value);
    setActiveIndex(0);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[20vh]"
      data-testid="command-palette-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[60vh] w-[560px] flex-col overflow-hidden rounded-lg bg-bg-primary shadow-lg"
        data-testid="command-palette-panel"
      >
        <div className="flex items-center border-b border-bg-hover">
          {prefix && (
            <span
              className="ml-3 rounded bg-bg-hover px-1.5 py-0.5 text-xs font-medium text-text-accent"
              data-testid="command-palette-mode-badge"
            >
              {prefix}
            </span>
          )}
          <input
            ref={inputRef}
            className="w-full bg-bg-primary px-4 py-3 text-text-normal outline-none"
            data-testid="command-palette-input"
            placeholder="Search… (@ annotations, # tags, / content)"
            value={rawInput}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />
        </div>

        {mode === "annotations" && (
          <div
            className="flex gap-1 border-b border-bg-hover px-3 py-1.5"
            data-testid="command-palette-type-filter"
          >
            {ANNOTATION_TYPES.map((t) => {
              const isActive = t === "all" ? typeFilter === null : typeFilter === t;
              return (
                <button
                  key={t}
                  data-testid={`type-filter-${t}`}
                  data-active={isActive ? "true" : "false"}
                  className={`rounded px-2 py-0.5 text-xs ${isActive ? "bg-bg-hover text-text-accent font-medium" : "text-text-muted hover:bg-bg-hover"}`}
                  onClick={() => setTypeFilter(t === "all" ? null : (t as AnnotationType))}
                >
                  {t === "all" ? "All" : TYPE_ICON[t as AnnotationType]}
                  {t !== "all" && <span className="ml-1">{t}</span>}
                </button>
              );
            })}
          </div>
        )}

        <div ref={listRef} className="flex-1 overflow-y-auto">
          {filteredCommands.map((cmd, i) => (
            <div
              key={cmd.id}
              data-testid="command-palette-command"
              data-active={i === activeIndex ? "true" : "false"}
              className={`cursor-pointer px-4 py-2 text-sm ${i === activeIndex ? "bg-bg-hover" : ""}`}
              onClick={() => handleCommandSelect(cmd)}
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-base">
                  {cmd.icon}
                </span>
                <span className="font-medium text-text-normal">{cmd.label}</span>
              </div>
            </div>
          ))}

          {mode === "annotations" && !query && (
            <div className="px-4 py-3 text-sm text-text-muted">
              Type to search annotations…
            </div>
          )}

          {mode === "annotations" && query && hasSearched && results.length === 0 && (
            <div className="px-4 py-3 text-sm text-text-muted">No results</div>
          )}

          {mode === "annotations" &&
            results.map((r, i) => {
              const itemIndex = filteredCommands.length + i;
              return (
              <div
                key={r.annotation_id}
                data-testid="command-palette-result"
                data-active={itemIndex === activeIndex ? "true" : "false"}
                className={`cursor-pointer px-4 py-2 text-sm ${itemIndex === activeIndex ? "bg-bg-hover" : ""}`}
                onClick={() => handleSelect(r)}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-bg-hover text-xs font-medium text-text-accent">
                    {TYPE_ICON[r.annotation_type]}
                  </span>
                  {certaintyMark(r.certainty) && (
                    <span className="text-xs text-text-muted">
                      {certaintyMark(r.certainty)}
                    </span>
                  )}
                  <span className="font-medium text-text-normal">
                    {r.node_title}
                  </span>
                  {r.date && (
                    <span className="ml-auto text-xs text-text-muted">
                      {r.date}
                    </span>
                  )}
                </div>
                {r.body && (
                  <div className="mt-0.5 pl-7 text-xs text-text-muted">
                    {truncateBody(r.body)}
                  </div>
                )}
              </div>
              );
            })}

          {mode === "titles" && query && (
            <div className="px-4 py-3 text-sm text-text-muted">
              Title search coming soon
            </div>
          )}

          {mode === "tags" && (
            <div className="px-4 py-3 text-sm text-text-muted">
              Tag search coming soon
            </div>
          )}

          {mode === "content" && (
            <div className="px-4 py-3 text-sm text-text-muted">
              Content search coming soon
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
