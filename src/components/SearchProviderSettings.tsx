import { usePreferencesStore, setSearchEnabledProviders } from "../stores/preferences";

const PROVIDERS: { id: string; label: string; description: string }[] = [
  { id: "openalex", label: "OpenAlex", description: "Open catalog of scholarly works" },
  { id: "crossref", label: "Crossref", description: "DOI metadata registry" },
  { id: "pubmed", label: "PubMed", description: "Biomedical literature (NCBI)" },
  { id: "semantic_scholar", label: "Semantic Scholar", description: "AI-powered research corpus (S2)" },
  { id: "unpaywall", label: "Unpaywall", description: "Open-access PDF finder" },
  { id: "core", label: "CORE", description: "Open-access research aggregator" },
  { id: "openreview", label: "OpenReview", description: "Peer review platform (ML/AI)" },
  { id: "arxiv", label: "arXiv", description: "Preprint server (physics, CS, math)" },
  { id: "biorxiv", label: "bioRxiv", description: "Preprint server (biology)" },
];

export function SearchProviderSettings() {
  const enabled = usePreferencesStore((s) => s.searchEnabledProviders);

  function handleToggle(id: string) {
    const next = enabled.includes(id)
      ? enabled.filter((p) => p !== id)
      : [...enabled, id];
    setSearchEnabledProviders(next);
  }

  function handleEnableAll() {
    setSearchEnabledProviders(PROVIDERS.map((p) => p.id));
  }

  function handleDisableAll() {
    setSearchEnabledProviders([]);
  }

  return (
    <div data-testid="search-provider-settings" className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <button
          data-testid="search-providers-enable-all"
          onClick={handleEnableAll}
          className="text-xs text-text-muted hover:text-text-normal"
        >
          Enable all
        </button>
        <span className="text-text-muted">|</span>
        <button
          data-testid="search-providers-disable-all"
          onClick={handleDisableAll}
          className="text-xs text-text-muted hover:text-text-normal"
        >
          Disable all
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {PROVIDERS.map(({ id, label, description }) => (
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
  );
}
