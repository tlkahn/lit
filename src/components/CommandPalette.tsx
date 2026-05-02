import { useState, useEffect, useRef, useCallback } from "react";
import {
  paletteRegistry,
  type PaletteProvider,
  type PaletteResult,
} from "../lib/paletteRegistry";
import { annotationProvider } from "../lib/annotationProvider";
import {
  fileProvider,
  tagProvider,
  contentProvider,
  commandProvider,
} from "../lib/stubProviders";
import { recordAccess, sortByFrecency } from "../lib/frecency";
import { certaintyMark } from "../editor/livePreview/annotationConstants";

let registered = false;
function ensureRegistered() {
  if (registered) return;
  paletteRegistry.register(fileProvider);
  paletteRegistry.register(annotationProvider);
  paletteRegistry.register(tagProvider);
  paletteRegistry.register(contentProvider);
  paletteRegistry.register(commandProvider);
  registered = true;
}

export function _resetRegistration() {
  registered = false;
}

interface ResolvedInput {
  provider: PaletteProvider | undefined;
  query: string;
  prefix: string | null;
}

function resolveProvider(raw: string): ResolvedInput {
  const firstChar = raw.charAt(0);
  const provider = paletteRegistry.getByPrefix(firstChar);
  if (provider) {
    return { provider, query: raw.slice(1), prefix: firstChar };
  }
  return { provider: undefined, query: raw, prefix: null };
}

interface SectionedResults {
  section: string;
  providerId: string;
  results: PaletteResult[];
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  ensureRegistered();

  const [rawInput, setRawInput] = useState("");
  const [sections, setSections] = useState<SectionedResults[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [filterValue, setFilterValue] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevProviderRef = useRef<string | null>(null);

  const { provider: activeProvider, query, prefix } = resolveProvider(rawInput);
  const currentProviderId = activeProvider?.id ?? null;

  if (currentProviderId !== prevProviderRef.current) {
    setFilterValue(null);
    prevProviderRef.current = currentProviderId;
  }

  const allResults = sections.flatMap((s) => s.results);

  useEffect(() => {
    if (open) {
      setRawInput("");
      setSections([]);
      setActiveIndex(0);
      setFilterValue(null);
      setHasSearched(false);
      prevProviderRef.current = null;
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query) {
      setSections([]);
      setHasSearched(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      if (activeProvider) {
        const results = await activeProvider.search(query, filterValue ?? undefined);
        const sorted = sortByFrecency(results, (r) => r.id);
        setSections([{ section: activeProvider.label, providerId: activeProvider.id, results: sorted }]);
      } else {
        const providers = paletteRegistry.getAll();
        const sectionResults = await Promise.all(
          providers.map(async (p) => {
            const results = await p.search(query);
            const sorted = sortByFrecency(results, (r) => r.id);
            return {
              section: p.label,
              providerId: p.id,
              results: sorted.slice(0, 5),
            };
          }),
        );
        setSections(sectionResults.filter((s) => s.results.length > 0));
      }
      setActiveIndex(0);
      setHasSearched(true);
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeProvider, query, filterValue]);

  useEffect(() => {
    if (allResults.length === 0) return;
    const activeEl = listRef.current?.querySelector('[data-active="true"]');
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, allResults.length]);

  const findProviderForIndex = useCallback(
    (index: number): PaletteProvider | undefined => {
      let count = 0;
      for (const s of sections) {
        if (index < count + s.results.length) {
          return paletteRegistry.getAll().find((p) => p.id === s.providerId);
        }
        count += s.results.length;
      }
      return undefined;
    },
    [sections],
  );

  const handleSelect = useCallback(
    (result: PaletteResult, index: number) => {
      recordAccess(result.id);
      const provider = activeProvider ?? findProviderForIndex(index);
      provider?.onSelect(result);
      onClose();
    },
    [activeProvider, findProviderForIndex, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (allResults.length > 0) {
          setActiveIndex((prev) => (prev + 1) % allResults.length);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (allResults.length > 0) {
          setActiveIndex((prev) => (prev - 1 + allResults.length) % allResults.length);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (allResults.length > 0 && allResults[activeIndex]) {
          handleSelect(allResults[activeIndex], activeIndex);
        }
      }
    },
    [allResults, activeIndex, handleSelect, onClose],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setRawInput(e.target.value);
    setActiveIndex(0);
  }, []);

  if (!open) return null;

  const isOmniMode = !activeProvider;
  const filterOptions = activeProvider?.filterOptions;

  let globalIndex = 0;

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

        {filterOptions && (
          <div
            className="flex gap-1 border-b border-bg-hover px-3 py-1.5"
            data-testid="command-palette-type-filter"
          >
            {filterOptions.map((opt) => {
              const isActive = opt.id === "all" ? filterValue === null : filterValue === opt.id;
              return (
                <button
                  key={opt.id}
                  data-testid={`type-filter-${opt.id}`}
                  data-active={isActive ? "true" : "false"}
                  className={`rounded px-2 py-0.5 text-xs ${isActive ? "bg-bg-hover text-text-accent font-medium" : "text-text-muted hover:bg-bg-hover"}`}
                  onClick={() => setFilterValue(opt.id === "all" ? null : opt.id)}
                >
                  {opt.id === "all" ? "All" : opt.icon}
                  {opt.id !== "all" && <span className="ml-1">{opt.label}</span>}
                </button>
              );
            })}
          </div>
        )}

        <div ref={listRef} className="flex-1 overflow-y-auto">
          {activeProvider && !query && (
            <div className="px-4 py-3 text-sm text-text-muted">
              Type to search {activeProvider.label.toLowerCase()}…
            </div>
          )}

          {query && hasSearched && allResults.length === 0 && (
            <div className="px-4 py-3 text-sm text-text-muted">No results</div>
          )}

          {sections.map((section) => {
            const sectionStartIndex = globalIndex;
            const elements = (
              <div key={section.providerId}>
                {isOmniMode && (
                  <div
                    className="px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-text-muted"
                    data-testid="palette-section-header"
                  >
                    {section.section}
                  </div>
                )}
                {section.results.map((r, localIdx) => {
                  const idx = sectionStartIndex + localIdx;
                  const data = r.data as { certainty?: string; date?: string } | undefined;
                  const certMark = data ? certaintyMark(data.certainty ?? "neutral") : "";
                  return (
                    <div
                      key={r.id}
                      data-testid="command-palette-result"
                      data-active={idx === activeIndex ? "true" : "false"}
                      className={`cursor-pointer px-4 py-2 text-sm ${idx === activeIndex ? "bg-bg-hover" : ""}`}
                      onClick={() => handleSelect(r, idx)}
                    >
                      <div className="flex items-center gap-2">
                        {r.icon && (
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-bg-hover text-xs font-medium text-text-accent">
                            {r.icon}
                          </span>
                        )}
                        {certMark && (
                          <span className="text-xs text-text-muted">
                            {certMark}
                          </span>
                        )}
                        <span className="font-medium text-text-normal">
                          {r.title}
                        </span>
                        {data?.date && (
                          <span className="ml-auto text-xs text-text-muted">
                            {data.date}
                          </span>
                        )}
                      </div>
                      {r.subtitle && (
                        <div className="mt-0.5 pl-7 text-xs text-text-muted">
                          {r.subtitle}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
            globalIndex += section.results.length;
            return elements;
          })}

          {isOmniMode && !query && (
            <div
              className="flex gap-4 border-t border-bg-hover px-4 py-2 text-xs text-text-muted"
              data-testid="palette-prefix-hints"
            >
              {paletteRegistry.getAll().filter((p) => p.prefix).map((p) => (
                <span key={p.id}>
                  <span className="font-medium text-text-accent">{p.prefix}</span>{" "}
                  {p.label.toLowerCase()}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
