import { useState, useEffect, useRef, useCallback } from "react";
import * as registry from "../lib/paletteRegistry";
import type { PaletteProvider, PaletteResult } from "../lib/paletteRegistry";
import { annotationProvider } from "../lib/annotationProvider";
import { fileProvider } from "../lib/fileProvider";
import { tagProvider } from "../lib/tagProvider";
import { contentProvider } from "../lib/contentProvider";
import { commandProvider } from "../lib/commandProvider";
import { initCoreCommands } from "../lib/commands/core";
import { initFuseFractureCommands } from "../lib/commands/fuseFracture";
import { initAcademicExportCommands } from "../lib/commands/academicExport";
import { initCompanionCommands } from "../lib/commands/companion";
import { initOcrCommands } from "../lib/commands/ocr";
import { initSidebarCommands } from "../lib/commands/sidebar";
import { recordAccess, sortByFrecency } from "../lib/frecency";

const omniContentHintProvider: PaletteProvider = {
  id: "__omni-content-hint__",
  label: "Content",
  priority: 999,
  async search() { return []; },
  onSelect(result: PaletteResult): false {
    const data = result.data as { query: string };
    window.dispatchEvent(
      new CustomEvent("lit:palette-set-input", { detail: { value: `/${data.query}` } }),
    );
    return false;
  },
};

interface SectionedResults {
  section: string;
  provider: PaletteProvider;
  results: PaletteResult[];
}

let registered = false;

function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  registry.register(fileProvider);
  registry.register(annotationProvider);
  registry.register(tagProvider);
  registry.register(contentProvider);
  registry.register(commandProvider);
  initCoreCommands();
  initFuseFractureCommands();
  initAcademicExportCommands();
  initCompanionCommands();
  initOcrCommands();
  initSidebarCommands();
}

export function _resetRegistration(): void {
  registered = false;
  registry._clear();
}

function resolveProvider(raw: string): { provider: PaletteProvider | null; query: string; prefix: string | null } {
  const firstChar = raw.charAt(0);
  const provider = firstChar ? registry.getByPrefix(firstChar) : null;
  if (provider) {
    return { provider, query: raw.slice(1), prefix: firstChar };
  }
  return { provider: null, query: raw, prefix: null };
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
  const [filter, setFilter] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPrefixRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  const { provider, query, prefix } = resolveProvider(rawInput);

  if (prefix !== prevPrefixRef.current) {
    setFilter(null);
    prevPrefixRef.current = prefix;
  }

  useEffect(() => {
    if (open) {
      setRawInput("");
      setSections([]);
      setActiveIndex(0);
      setFilter(null);
      setHasSearched(false);
      setSearchError(null);
      prevPrefixRef.current = null;
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { value: string };
      if (detail?.value != null) setRawInput(detail.value);
    };
    window.addEventListener("lit:palette-set-input", handler);
    return () => window.removeEventListener("lit:palette-set-input", handler);
  }, [open]);

  const providerId = provider?.id ?? null;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (providerId) {
      if (!query) {
        setSections([]);
        setHasSearched(false);
        setSearchError(null);
        return;
      }
      const currentPrefix = prefix!;
      debounceRef.current = setTimeout(async () => {
        const id = ++requestIdRef.current;
        const p = registry.getByPrefix(currentPrefix);
        if (!p) return;
        try {
          const results = await p.search(query, filter ?? undefined);
          if (id !== requestIdRef.current) return;
          setSections([{ section: p.label, provider: p, results }]);
          setSearchError(null);
        } catch (err) {
          if (id !== requestIdRef.current) return;
          console.warn("[CommandPalette] search failed:", err);
          setSections([]);
          setSearchError("Search failed");
        }
        setActiveIndex(0);
        setHasSearched(true);
      }, 250);
    } else {
      if (!query) {
        setSections([]);
        setHasSearched(false);
        setSearchError(null);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        const id = ++requestIdRef.current;
        const allProviders = registry.getForOmni();
        const allSections: SectionedResults[] = [];
        let hasError = false;
        const settled = await Promise.all(
          allProviders.map(async (p) => {
            try {
              const results = await p.search(query);
              return { provider: p, results };
            } catch (err) {
              console.warn("[CommandPalette] provider failed:", p.id, err);
              hasError = true;
              return { provider: p, results: [] as PaletteResult[] };
            }
          }),
        );
        if (id !== requestIdRef.current) return;
        for (const { provider: p, results } of settled) {
          if (results.length > 0) {
            allSections.push({
              section: p.label,
              provider: p,
              results: sortByFrecency(results.slice(0, 5), (r) => r.id),
            });
          }
        }
        const hasRealResults = allSections.length > 0;
        if (!hasError || hasRealResults) {
          allSections.push({
            section: "Content",
            provider: omniContentHintProvider,
            results: [{
              id: "__omni-content-hint__",
              title: `Search content for "${query}"…`,
              icon: "",
              section: "Content",
              data: { query },
            }],
          });
        }
        setSections(allSections);
        setSearchError(hasError && !hasRealResults ? "Search failed" : null);
        setActiveIndex(0);
        setHasSearched(true);
      }, 250);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      requestIdRef.current++;
    };
  }, [providerId, prefix, query, filter]);

  const allResults = sections.flatMap((s) => s.results);
  const totalItems = allResults.length;
  const realResultCount = sections
    .filter(s => s.provider.id !== "__omni-content-hint__")
    .flatMap(s => s.results).length;

  useEffect(() => {
    if (totalItems === 0) return;
    const activeEl = listRef.current?.querySelector('[data-active="true"]');
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, totalItems]);

  const handleSelect = useCallback(
    (result: PaletteResult) => {
      recordAccess(result.id);
      const owningSection = sections.find((s) => s.results.includes(result));
      if (owningSection) {
        const rv = owningSection.provider.onSelect(result);
        if (rv === false) return;
      }
      onClose();
    },
    [sections, onClose],
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
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prefix === "/") {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("lit:open-search-panel-with-query", {
            detail: { query },
          }),
        );
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (allResults[activeIndex]) {
          handleSelect(allResults[activeIndex]);
        }
      }
    },
    [allResults, activeIndex, totalItems, handleSelect, onClose, prefix, query],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setRawInput(e.target.value);
    setActiveIndex(0);
  }, []);

  if (!open) return null;

  const isOmniMode = !prefix;
  const activeProvider = provider;
  const showFilter = activeProvider?.filterOptions && activeProvider.filterOptions.length > 0;

  const resultIndexMap = new Map<PaletteResult, number>();
  let idx = 0;
  for (const section of sections) {
    for (const result of section.results) {
      resultIndexMap.set(result, idx++);
    }
  }

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
            placeholder="Search… (@ annotations, # tags, / content, ! commands)"
            value={rawInput}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />
        </div>

        {showFilter && (
          <div
            className="flex gap-1 border-b border-bg-hover px-3 py-1.5"
            data-testid="command-palette-type-filter"
          >
            {activeProvider!.filterOptions!.map((opt) => {
              const isActive = opt.id === "all" ? filter === null : filter === opt.id;
              return (
                <button
                  key={opt.id}
                  data-testid={`type-filter-${opt.id}`}
                  data-active={isActive ? "true" : "false"}
                  className={`rounded px-2 py-0.5 text-xs ${isActive ? "bg-bg-hover text-text-accent font-medium" : "text-text-muted hover:bg-bg-hover"}`}
                  onClick={() => setFilter(opt.id === "all" ? null : opt.id)}
                >
                  {opt.icon && <span>{opt.icon}</span>}
                  {opt.id !== "all" && <span className="ml-1">{opt.label}</span>}
                  {opt.id === "all" && <span>{opt.label}</span>}
                </button>
              );
            })}
          </div>
        )}

        <div ref={listRef} className="flex-1 overflow-y-auto">
          {provider && !query && (
            <div className="px-4 py-3 text-sm text-text-muted">
              Type to search {provider.label.toLowerCase()}…
            </div>
          )}

          {hasSearched && realResultCount === 0 && !searchError && (
            <div className="px-4 py-3 text-sm text-text-muted">No results</div>
          )}

          {searchError && (
            <div className="px-4 py-3 text-sm text-text-error" data-testid="search-error-message">
              {searchError}
            </div>
          )}

          {sections.map((section) => {
            const sectionElements = section.results.map((result) => {
              const i = resultIndexMap.get(result)!;
              const isHint = result.id === "__omni-content-hint__";
              return (
                <div
                  key={result.id}
                  data-testid={isHint ? "command-palette-content-hint" : "command-palette-result"}
                  data-active={i === activeIndex ? "true" : "false"}
                  className={`cursor-pointer px-4 py-2 text-sm ${i === activeIndex ? "bg-bg-hover" : ""}`}
                  onClick={() => handleSelect(result)}
                >
                  <div className="flex items-center gap-2">
                    {result.icon && (
                      <span className="nerd-font inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-bg-hover text-xs font-medium text-text-accent">
                        {result.icon}
                      </span>
                    )}
                    <span className={isHint ? "text-text-muted italic" : "font-medium text-text-normal"}>
                      {result.title}
                    </span>
                    {result.shortcut && (
                      <span className="ml-auto text-xs text-text-muted">
                        {result.shortcut}
                      </span>
                    )}
                  </div>
                  {result.subtitle && (
                    <div className="mt-0.5 pl-7 text-xs text-text-muted">
                      {result.subtitle}
                    </div>
                  )}
                </div>
              );
            });

            return (
              <div key={section.section}>
                {isOmniMode && (
                  <div
                    className="px-4 py-1.5 text-xs font-medium text-text-muted uppercase"
                    data-testid="palette-section-header"
                  >
                    {section.section}
                  </div>
                )}
                {sectionElements}
              </div>
            );
          })}

          {isOmniMode && !query && (
            <div className="px-4 py-3 text-xs text-text-muted" data-testid="prefix-hints">
              <span className="mr-3">@ annotations</span>
              <span className="mr-3"># tags</span>
              <span className="mr-3">/ content</span>
              <span className="mr-3">$ files</span>
              <span>! commands</span>
            </div>
          )}
        </div>

        {prefix === "/" && query && (
          <div className="border-t border-bg-hover px-4 py-1.5 text-xs text-text-faint" data-testid="search-panel-bridge-hint">
            <kbd className="rounded bg-bg-hover px-1 py-0.5 text-[10px]">
              {typeof navigator !== "undefined" && navigator.platform?.includes("Mac") ? "Cmd" : "Ctrl"}+Enter
            </kbd>{" "}
            Open in search panel
          </div>
        )}
      </div>
    </div>
  );
}
