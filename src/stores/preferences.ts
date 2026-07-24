import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { DarkModePref, ViewMode, Preferences } from "../lib/ipc";
import { getPreferences, setPreference, deleteApiKey, hasApiKey, isViewMode, listSearchProviders } from "../lib/ipc";
import type { AnnotationBuilderDefaults } from "../lib/annotationBuilderDefaults";
import { isValidBuilderDefaults } from "../lib/annotationBuilderDefaults";
import { providerIdForModel } from "../lib/providerRegistry";
import type { CustomProviderDef } from "../lib/providerRegistry";

export type FoldingShowControls = "mouseover" | "always" | "never";

export type AnnotationDisplayMode = "pill" | "footnote";

export type BottomPanelPosition = "bottom" | "side";

export interface LlmProviderConfig {
  providerId: string;
  model: string;
  baseUrl?: string;
  apiKeySet: boolean;
}

export interface PreferencesState {
  darkMode: DarkModePref;
  colorTheme: string | null;
  sidebarVisible: boolean;
  sidebarLocation: "left" | "right";
  foldingEnabled: boolean;
  foldingShowControls: FoldingShowControls;
  crossrefEnabled: boolean;
  crossrefLiveRendering: boolean;
  crossrefEnableCiteproc: boolean;
  mediaThumbnails: boolean;
  experimentalUnlinkedReferences: boolean;
  annotationEnabled: boolean;
  annotationScopeHighlight: boolean;
  annotationDefaultLang: string;
  annotationDisplayMode: AnnotationDisplayMode;
  llmProvider: LlmProviderConfig;
  llmCustomProviders: CustomProviderDef[];
  llmSystemPrompt: string;
  llmTemperature: number;
  neighborsDepth: number;
  llmPromptLlm: string;
  llmPromptTr: string;
  llmPromptQ: string;
  bottomPanelPosition: BottomPanelPosition;
  academicPandocPath: string;
  academicCrossrefPath: string;
  academicDefaultCsl: string;
  academicDefaultTemplate: string;
  academicDefaultReferenceDoc: string;
  academicIndicFont: string;
  defaultViewMode: ViewMode;
  graphViewEnabled: boolean;
  annotationPrefillLastUsed: boolean;
  annotationBuilderDefaults: AnnotationBuilderDefaults | null;
  companionSearchPath: string[];
  citationNotesDir: string;
  defaultImageDir: string;
  searchEnabledProviders: string[];
  searchCrossrefEmail: string;
  searchUnpaywallEmail: string;
  searchProviderTimeout: number;
  searchS2ApiKeySet: boolean;
  searchCoreApiKeySet: boolean;
  searchPubmedApiKeySet: boolean;
  searchGoogleBooksApiKeySet: boolean;
  searchBaseApiKeySet: boolean;
  fontInterfaceList: string[];
  fontTextList: string[];
  fontMonospaceList: string[];
  fontTextSize: number;
  autoRevealInSidebar: boolean;
  loaded: boolean;
  loadPreferences: () => Promise<void>;
}

function applySidebarLocation(val: string): "left" | "right" {
  return val === "right" ? "right" : "left";
}

function applyFoldingShowControls(val: string): FoldingShowControls {
  if (val === "always" || val === "never") return val;
  return "mouseover";
}

function applyAnnotationDisplayMode(val: unknown): AnnotationDisplayMode {
  if (val === "footnote") return "footnote";
  return "pill";
}

function applyBottomPanelPosition(val: unknown): BottomPanelPosition {
  return val === "side" ? "side" : "bottom";
}

function applyDefaultViewMode(val: unknown): ViewMode {
  return isViewMode(val) ? val : "editor";
}

function applyDarkMode(val: unknown): DarkModePref {
  if (val === "light" || val === "dark" || val === "auto") return val;
  if (val === true) return "dark";
  if (val === false) return "light";
  return "auto";
}

export function migrateLlmProvider(prefs: Preferences): LlmProviderConfig {
  const existing = prefs["llm.provider"];
  if (
    existing != null &&
    typeof existing === "object" &&
    typeof (existing as Record<string, unknown>).providerId === "string"
  ) {
    const obj = existing as Record<string, unknown>;
    return {
      providerId: obj.providerId as string,
      model: (obj.model as string) || "claude-sonnet-4-6",
      baseUrl: obj.baseUrl ? String(obj.baseUrl) : undefined,
      apiKeySet: (obj.apiKeySet as boolean) ?? false,
    };
  }

  const model = (prefs["llm.model"] as string) ?? "claude-sonnet-4-6";
  const providerId = providerIdForModel(model);
  const rawBaseUrl =
    providerId === "anthropic"
      ? (prefs["llm.anthropic.baseUrl"] as string)
      : (prefs["llm.openai.baseUrl"] as string);
  const baseUrl = rawBaseUrl && rawBaseUrl.trim() !== "" ? rawBaseUrl : undefined;

  return { providerId, model, baseUrl, apiKeySet: false };
}

function isCustomProviderDef(val: unknown): val is CustomProviderDef {
  if (val == null || typeof val !== "object") return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    obj.id.startsWith("custom-") &&
    typeof obj.name === "string" &&
    typeof obj.baseUrl === "string" &&
    typeof obj.needsApiKey === "boolean" &&
    typeof obj.modelId === "string" &&
    typeof obj.contextWindow === "number"
  );
}

function applyCustomProviders(val: unknown): CustomProviderDef[] {
  if (!Array.isArray(val)) return [];
  return val.filter(isCustomProviderDef).map((def) => ({
    id: def.id,
    name: def.name,
    baseUrl: def.baseUrl,
    needsApiKey: def.needsApiKey,
    modelId: def.modelId,
    contextWindow: def.contextWindow,
  }));
}

function applyFontList(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((entry): entry is string => typeof entry === "string");
}

function applyFontSize(val: unknown): number {
  if (typeof val !== "number") return 16;
  return Math.max(10, Math.min(30, Math.round(val)));
}

function applyImageDir(val: unknown): string {
  if (typeof val === "string" && val !== "") return val;
  return "assets/images";
}

function applyCompanionSearchPath(val: unknown): string[] {
  if (!Array.isArray(val)) return ["."];
  const filtered = val.filter((entry): entry is string => typeof entry === "string");
  return filtered.length > 0 ? filtered : ["."];
}

/** Canonical list of all search providers, in display order. */
const ALL_SEARCH_PROVIDERS: string[] = [
  "openalex", "crossref", "base", "pubmed", "biorxiv",
  "semantic_scholar", "openreview", "arxiv", "unpaywall",
  "core", "zenodo", "doaj", "open_library", "google_books", "hathitrust",
];

function applySearchEnabledProviders(val: unknown): string[] | null {
  if (!Array.isArray(val)) return null;
  const persisted = val.filter((entry): entry is string => typeof entry === "string");
  // Empty array = user explicitly disabled all providers; respect that choice.
  if (persisted.length === 0) return persisted;
  // Merge in any providers that were added after the user's config was saved.
  // New providers are appended at the end, enabled by default.
  const missing = ALL_SEARCH_PROVIDERS.filter((p) => !persisted.includes(p));
  return missing.length > 0 ? [...persisted, ...missing] : persisted;
}

function mapPreferences(prefs: Preferences) {
  const searchProviders = applySearchEnabledProviders(prefs["search.enabledProviders"]);
  return {
    darkMode: applyDarkMode(prefs["workbench.darkMode"]),
    colorTheme: prefs["workbench.colorTheme"] ?? null,
    sidebarVisible: (prefs["workbench.sideBar.visible"] as boolean) ?? true,
    sidebarLocation: applySidebarLocation(prefs["workbench.sideBar.location"] ?? "left"),
    defaultViewMode: applyDefaultViewMode(prefs["workbench.defaultViewMode"]),
    graphViewEnabled: (prefs["workbench.graphView.enabled"] as boolean) ?? false,
    bottomPanelPosition: applyBottomPanelPosition(prefs["workbench.bottomPanel.position"]),
    foldingEnabled: prefs["editor.folding.enabled"] ?? true,
    foldingShowControls: applyFoldingShowControls(prefs["editor.folding.showFoldingControls"] ?? "mouseover"),
    crossrefEnabled: (prefs["crossref.enabled"] as boolean) ?? true,
    crossrefLiveRendering: (prefs["crossref.liveRendering"] as boolean) ?? true,
    crossrefEnableCiteproc: (prefs["crossref.enableCiteproc"] as boolean) ?? true,
    mediaThumbnails: (prefs["editor.mediaThumbnails"] as boolean) ?? true,
    experimentalUnlinkedReferences: (prefs["experimental.unlinkedReferences"] as boolean) ?? true,
    annotationEnabled: (prefs["annotations.enabled"] as boolean) ?? true,
    annotationScopeHighlight: (prefs["annotations.scopeHighlight"] as boolean) ?? true,
    annotationDefaultLang: (prefs["annotations.defaultLang"] as string) ?? "en",
    annotationDisplayMode: applyAnnotationDisplayMode(prefs["annotations.displayMode"]),
    llmProvider: migrateLlmProvider(prefs),
    llmCustomProviders: applyCustomProviders(prefs["llm.customProviders"]),
    llmSystemPrompt: (prefs["llm.systemPrompt"] as string) ?? "",
    llmTemperature: (prefs["llm.temperature"] as number) ?? 0.7,
    neighborsDepth: (prefs["llm.neighborsDepth"] as number) ?? 1,
    llmPromptLlm: (prefs["llm.prompts.llm"] as string) ?? "Execute the following instruction using the provided context.",
    llmPromptTr: (prefs["llm.prompts.tr"] as string) ?? "Translate the following text. If a hint is provided, follow it.",
    llmPromptQ: (prefs["llm.prompts.q"] as string) ?? "Answer the following question about the provided context.",
    academicPandocPath: (prefs["academic.pandocPath"] as string) ?? "",
    academicCrossrefPath: (prefs["academic.crossrefFilterPath"] as string) ?? "",
    academicDefaultCsl: (prefs["academic.defaultCsl"] as string) ?? "",
    academicDefaultTemplate: (prefs["academic.defaultTemplate"] as string) ?? "",
    academicDefaultReferenceDoc: (prefs["academic.defaultReferenceDoc"] as string) ?? "",
    academicIndicFont: (prefs["academic.indicFont"] as string) ?? "",
    annotationPrefillLastUsed: (prefs["annotations.prefillLastUsed"] as boolean) ?? false,
    annotationBuilderDefaults: isValidBuilderDefaults(prefs["annotations.builderDefaults"]) ? prefs["annotations.builderDefaults"] : null,
    fontInterfaceList: applyFontList(prefs["appearance.interfaceFontList"]),
    fontTextList: applyFontList(prefs["appearance.textFontList"]),
    fontMonospaceList: applyFontList(prefs["appearance.monospaceFontList"]),
    fontTextSize: applyFontSize(prefs["appearance.baseFontSize"]),
    companionSearchPath: applyCompanionSearchPath(prefs["companion.searchPath"]),
    citationNotesDir: (prefs["citation.notesDir"] as string) ?? "references",
    defaultImageDir: applyImageDir(prefs["editor.defaultImageDir"]),
    autoRevealInSidebar: (prefs["workbench.autoRevealInSidebar"] as boolean) ?? false,
    ...(searchProviders !== null ? { searchEnabledProviders: searchProviders } : {}),
    searchCrossrefEmail: (prefs["search.crossrefEmail"] as string) ?? "",
    searchUnpaywallEmail: (prefs["search.unpaywallEmail"] as string) ?? "",
    searchProviderTimeout: (prefs["search.providerTimeout"] as number) ?? 30,
  };
}

export function setLlmProvider(patch: Partial<LlmProviderConfig>) {
  const prev = usePreferencesStore.getState().llmProvider;
  const next = { ...prev, ...patch };
  usePreferencesStore.setState({ llmProvider: next });
  setPreference("llm.provider", next).catch(() => {
    usePreferencesStore.setState({ llmProvider: prev });
  });
}

export type FontCategory = "interface" | "text" | "monospace";

const FONT_CATEGORY_META: Record<FontCategory, { storeField: "fontInterfaceList" | "fontTextList" | "fontMonospaceList"; jsonKey: string }> = {
  interface: { storeField: "fontInterfaceList", jsonKey: "appearance.interfaceFontList" },
  text: { storeField: "fontTextList", jsonKey: "appearance.textFontList" },
  monospace: { storeField: "fontMonospaceList", jsonKey: "appearance.monospaceFontList" },
};

export function setFontList(category: FontCategory, fonts: string[]) {
  const { storeField, jsonKey } = FONT_CATEGORY_META[category];
  const prev = usePreferencesStore.getState()[storeField];
  const next = applyFontList(fonts);
  usePreferencesStore.setState({ [storeField]: next });
  setPreference(jsonKey, next).catch(() => {
    usePreferencesStore.setState((state) =>
      state[storeField] === next ? { [storeField]: prev } : {},
    );
  });
}

export function setFontTextSize(size: number) {
  const prev = usePreferencesStore.getState().fontTextSize;
  const next = applyFontSize(size);
  usePreferencesStore.setState({ fontTextSize: next });
  setPreference("appearance.baseFontSize", next).catch(() => {
    usePreferencesStore.setState((state) =>
      state.fontTextSize === next ? { fontTextSize: prev } : {},
    );
  });
}

export function setCompanionSearchPath(paths: string[]) {
  const prev = usePreferencesStore.getState().companionSearchPath;
  const next = applyCompanionSearchPath(paths);
  usePreferencesStore.setState({ companionSearchPath: next });
  setPreference("companion.searchPath", next).catch(() => {
    usePreferencesStore.setState((state) =>
      state.companionSearchPath === next ? { companionSearchPath: prev } : {},
    );
  });
}

export function setSearchEnabledProviders(providers: string[]) {
  const prev = usePreferencesStore.getState().searchEnabledProviders;
  const next = providers.filter((p): p is string => typeof p === "string");
  usePreferencesStore.setState({ searchEnabledProviders: next });
  setPreference("search.enabledProviders", next).catch(() => {
    usePreferencesStore.setState((state) =>
      state.searchEnabledProviders === next ? { searchEnabledProviders: prev } : {},
    );
  });
}

export function addCustomProvider(def: CustomProviderDef) {
  const prev = usePreferencesStore.getState().llmCustomProviders;
  const next = [...prev, def];
  usePreferencesStore.setState({ llmCustomProviders: next });
  setPreference("llm.customProviders", next).catch(() => {
    usePreferencesStore.setState({ llmCustomProviders: prev });
  });
}

export function updateCustomProvider(id: string, patch: Partial<CustomProviderDef>) {
  const prev = usePreferencesStore.getState().llmCustomProviders;
  const next = prev.map((p) => (p.id === id ? { ...p, ...patch } : p));
  usePreferencesStore.setState({ llmCustomProviders: next });
  setPreference("llm.customProviders", next).catch(() => {
    usePreferencesStore.setState({ llmCustomProviders: prev });
  });
}

export function removeCustomProvider(id: string) {
  const prev = usePreferencesStore.getState().llmCustomProviders;
  const next = prev.filter((p) => p.id !== id);
  usePreferencesStore.setState({ llmCustomProviders: next });
  setPreference("llm.customProviders", next).catch(() => {
    usePreferencesStore.setState({ llmCustomProviders: prev });
  });
  // Clean up any stored credential. A custom provider with needsApiKey:false
  // may have no stored key, so swallow errors and never roll back the array.
  deleteApiKey(id).catch(() => {});
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  darkMode: "auto",
  colorTheme: null,
  sidebarVisible: true,
  sidebarLocation: "left",
  defaultViewMode: "editor",
  graphViewEnabled: false,
  bottomPanelPosition: "bottom",
  foldingEnabled: true,
  foldingShowControls: "mouseover",
  crossrefEnabled: true,
  crossrefLiveRendering: true,
  crossrefEnableCiteproc: true,
  mediaThumbnails: true,
  experimentalUnlinkedReferences: true,
  annotationEnabled: true,
  annotationScopeHighlight: true,
  annotationDefaultLang: "en",
  annotationDisplayMode: "pill",
  llmProvider: { providerId: "anthropic", model: "claude-sonnet-4-6", apiKeySet: false },
  llmCustomProviders: [],
  llmSystemPrompt: "",
  llmTemperature: 0.7,
  neighborsDepth: 1,
  llmPromptLlm: "Execute the following instruction using the provided context.",
  llmPromptTr: "Translate the following text. If a hint is provided, follow it.",
  llmPromptQ: "Answer the following question about the provided context.",
  academicPandocPath: "",
  academicCrossrefPath: "",
  academicDefaultCsl: "",
  academicDefaultTemplate: "",
  academicDefaultReferenceDoc: "",
  academicIndicFont: "",
  annotationPrefillLastUsed: false,
  annotationBuilderDefaults: null,
  companionSearchPath: ["."],
  citationNotesDir: "references",
  defaultImageDir: "assets/images",
  // Synchronous fallback -- overridden by Rust canonical list via IPC on fresh install.
  // Keep in sync with PROVIDER_INFO / LEGAL_PROVIDER_IDS in src-tauri/src/bib/research_hub.rs.
  searchEnabledProviders: ALL_SEARCH_PROVIDERS,
  searchCrossrefEmail: "",
  searchUnpaywallEmail: "",
  searchProviderTimeout: 30,
  searchS2ApiKeySet: false,
  searchCoreApiKeySet: false,
  searchPubmedApiKeySet: false,
  searchGoogleBooksApiKeySet: false,
  searchBaseApiKeySet: false,
  fontInterfaceList: [],
  fontTextList: [],
  fontMonospaceList: [],
  fontTextSize: 16,
  autoRevealInSidebar: false,
  loaded: false,

  loadPreferences: async () => {
    try {
      const prefs = await getPreferences();
      set({ ...mapPreferences(prefs), loaded: true });

      // When search.enabledProviders is absent from persisted prefs (fresh install
      // or pre-TurboRef upgrade), fetch the canonical provider list from Rust
      // instead of relying on the hardcoded TS default. This ensures Rust is the
      // single source of truth for which providers exist.
      if (applySearchEnabledProviders(prefs["search.enabledProviders"]) === null) {
        listSearchProviders()
          .then((providers) => {
            const ids = providers.map((p) => p.id);
            set({ searchEnabledProviders: ids });
          })
          .catch(() => {
            // IPC failed -- keep the hardcoded fallback already in the store
          });
      }

      // Persist the migrated llm.provider exactly once, only when migration
      // actually synthesized it from legacy flat keys (no valid object on disk).
      // Otherwise every launch re-runs migration from stale keys and Rust code
      // paths reading on-disk llm.provider never see the migrated config. Use
      // the same predicate as migrateLlmProvider so "ran vs passed-through" agree.
      const existingProvider = prefs["llm.provider"];
      const hadPersistedProvider =
        existingProvider != null &&
        typeof existingProvider === "object" &&
        typeof (existingProvider as Record<string, unknown>).providerId === "string";
      if (!hadPersistedProvider) {
        // Snapshot the migrated config now (apiKeySet:false), before the async
        // hasApiKey upgrade below mutates the store. The persisted object stays
        // deterministic; the in-memory upgrade is a UX-only convenience.
        const migrated = usePreferencesStore.getState().llmProvider;
        setPreference("llm.provider", migrated).catch(() => {});
      }

      // Reconcile apiKeySet against the real credential store. migrateLlmProvider
      // hard-codes apiKeySet:false for legacy users, so upgraded users with a
      // saved key would otherwise have LLM features disabled until they open
      // Settings. Fire-and-forget so caller resolution timing is unchanged.
      const checkedProviderId = usePreferencesStore.getState().llmProvider.providerId;
      hasApiKey(checkedProviderId)
        .then((has) => {
          // Only upgrade to true — never clobber. A locked-but-existing secret
          // store returns false for every provider; downgrading here would be a
          // false negative (SettingsModal corrects it once unlocked).
          if (!has) return;
          // Skip if the provider changed during the async window (e.g. a
          // preferences://changed event or user provider switch).
          set((prev) =>
            prev.llmProvider.providerId === checkedProviderId && !prev.llmProvider.apiKeySet
              ? { llmProvider: { ...prev.llmProvider, apiKeySet: true } }
              : {},
          );
        })
        .catch(() => {});
    } catch {
      set({ loaded: true });
    }

    try {
      await listen<Preferences>("preferences://changed", (event) => {
        set(mapPreferences(event.payload));
      });
    } catch {
      // event API unavailable
    }
  },
}));
