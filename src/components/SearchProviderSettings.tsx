import { useState, useEffect, useCallback } from "react";
import { usePreferencesStore, setSearchEnabledProviders } from "../stores/preferences";
import { listSearchProviders, type ProviderInfo } from "../lib/ipc";

let cachedProviders: ProviderInfo[] | null = null;

/** Reset the module-level cache. Exported for tests only. */
export function _resetCachedProviders() {
  cachedProviders = null;
}

const CATEGORY_ORDER = ["general", "biomedical", "cs-ml", "open-access"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  biomedical: "Biomedical",
  "cs-ml": "CS & ML",
  "open-access": "Open Access",
};

export interface ProviderGroup {
  category: string;
  label: string;
  providers: ProviderInfo[];
}

export function groupProviders(providers: ProviderInfo[]): ProviderGroup[] {
  const knownCategories = new Set<string>(CATEGORY_ORDER);
  const ungrouped = providers.filter((p) => !knownCategories.has(p.category));
  return [
    ...CATEGORY_ORDER.map((cat) => ({
      category: cat,
      label: CATEGORY_LABELS[cat] ?? cat,
      providers: providers.filter((p) => p.category === cat),
    })),
    ...(ungrouped.length > 0
      ? [{ category: "other", label: "Other", providers: ungrouped }]
      : []),
  ].filter((g) => g.providers.length > 0);
}

export function SearchProviderSettings() {
  const enabled = usePreferencesStore((s) => s.searchEnabledProviders);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchProviders = useCallback(() => {
    if (cachedProviders) {
      setProviders(cachedProviders);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    listSearchProviders()
      .then((result) => {
        const list = result ?? [];
        cachedProviders = list;
        setProviders(list);
      })
      .catch((err: unknown) => {
        console.error("Failed to load search providers:", err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  function retry() {
    fetchProviders();
  }

  function handleToggle(id: string) {
    const next = enabled.includes(id)
      ? enabled.filter((p) => p !== id)
      : [...enabled, id];
    setSearchEnabledProviders(next);
  }

  function handleEnableAll() {
    setSearchEnabledProviders(providers.map((p) => p.id));
  }

  function handleDisableAll() {
    setSearchEnabledProviders([]);
  }

  const grouped = groupProviders(providers);

  return (
    <div data-testid="search-provider-settings" className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <button
          data-testid="search-providers-enable-all"
          onClick={handleEnableAll}
          disabled={providers.length === 0}
          className="text-xs text-text-muted hover:text-text-normal disabled:opacity-50"
        >
          Enable all
        </button>
        <span className="text-text-muted">|</span>
        <button
          data-testid="search-providers-disable-all"
          onClick={handleDisableAll}
          disabled={providers.length === 0}
          className="text-xs text-text-muted hover:text-text-normal disabled:opacity-50"
        >
          Disable all
        </button>
      </div>
      {loading ? (
        <div className="text-xs text-text-muted">Loading providers...</div>
      ) : error ? (
        <div className="text-xs text-text-error">
          Failed to load providers.{" "}
          <button onClick={retry} className="text-interactive-accent hover:underline">Retry</button>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((group) => (
            <div key={group.category}>
              <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
                {group.label}
              </h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {group.providers.map(({ id, label, description }) => (
                  <label
                    key={id}
                    data-testid={`search-provider-${id}`}
                    className="flex items-start gap-2 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={enabled.includes(id)}
                      onChange={() => handleToggle(id)}
                      className="mt-0.5 accent-accent"
                    />
                    <div className="min-w-0">
                      <span className="text-sm text-text-normal group-hover:text-text-normal">
                        {label}
                      </span>
                      <span className="block text-xs text-text-muted">{description}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
