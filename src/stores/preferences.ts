import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { DarkModePref, ViewMode, Preferences } from "../lib/ipc";
import { getPreferences, setPreference, deleteApiKey, hasApiKey } from "../lib/ipc";
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
  llmModel: string;
  llmOpenaiBaseUrl: string;
  llmAnthropicBaseUrl: string;
  llmProvider: LlmProviderConfig;
  llmCustomProviders: CustomProviderDef[];
  llmSystemPrompt: string;
  llmTemperature: number;
  neighborsDepth: number;
  llmPromptLlm: string;
  llmPromptTr: string;
  llmPromptQ: string;
  bottomPanelPosition: BottomPanelPosition;
  llmOpenaiApiKeySet: boolean;
  llmAnthropicApiKeySet: boolean;
  academicPandocPath: string;
  academicCrossrefPath: string;
  academicPdfEngine: string;
  academicDefaultCsl: string;
  academicDefaultTemplate: string;
  academicDefaultReferenceDoc: string;
  defaultViewMode: ViewMode;
  annotationPrefillLastUsed: boolean;
  annotationBuilderDefaults: AnnotationBuilderDefaults | null;
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
  if (val === "editor" || val === "mindmap" || val === "graph") return val;
  return "editor";
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

function mapPreferences(prefs: Preferences) {
  return {
    darkMode: applyDarkMode(prefs["workbench.darkMode"]),
    colorTheme: prefs["workbench.colorTheme"] ?? null,
    sidebarVisible: (prefs["workbench.sideBar.visible"] as boolean) ?? true,
    sidebarLocation: applySidebarLocation(prefs["workbench.sideBar.location"] ?? "left"),
    defaultViewMode: applyDefaultViewMode(prefs["workbench.defaultViewMode"]),
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
    llmModel: (prefs["llm.model"] as string) ?? "claude-sonnet-4-6",
    llmOpenaiBaseUrl: (prefs["llm.openai.baseUrl"] as string) ?? "",
    llmAnthropicBaseUrl: (prefs["llm.anthropic.baseUrl"] as string) ?? "",
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
    academicPdfEngine: (prefs["academic.pdfEngine"] as string) ?? "",
    academicDefaultCsl: (prefs["academic.defaultCsl"] as string) ?? "",
    academicDefaultTemplate: (prefs["academic.defaultTemplate"] as string) ?? "",
    academicDefaultReferenceDoc: (prefs["academic.defaultReferenceDoc"] as string) ?? "",
    annotationPrefillLastUsed: (prefs["annotations.prefillLastUsed"] as boolean) ?? false,
    annotationBuilderDefaults: isValidBuilderDefaults(prefs["annotations.builderDefaults"]) ? prefs["annotations.builderDefaults"] : null,
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
  llmModel: "claude-sonnet-4-6",
  llmOpenaiBaseUrl: "",
  llmAnthropicBaseUrl: "",
  llmProvider: { providerId: "anthropic", model: "claude-sonnet-4-6", apiKeySet: false },
  llmCustomProviders: [],
  llmSystemPrompt: "",
  llmTemperature: 0.7,
  neighborsDepth: 1,
  llmPromptLlm: "Execute the following instruction using the provided context.",
  llmPromptTr: "Translate the following text. If a hint is provided, follow it.",
  llmPromptQ: "Answer the following question about the provided context.",
  llmOpenaiApiKeySet: false,
  llmAnthropicApiKeySet: false,
  academicPandocPath: "",
  academicCrossrefPath: "",
  academicPdfEngine: "",
  academicDefaultCsl: "",
  academicDefaultTemplate: "",
  academicDefaultReferenceDoc: "",
  annotationPrefillLastUsed: false,
  annotationBuilderDefaults: null,
  loaded: false,

  loadPreferences: async () => {
    try {
      const prefs = await getPreferences();
      set({ ...mapPreferences(prefs), loaded: true });

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
            prev.llmProvider.providerId === checkedProviderId
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
