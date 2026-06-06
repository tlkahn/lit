import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { DarkModePref, ViewMode, Preferences } from "../lib/ipc";
import { getPreferences } from "../lib/ipc";
import type { AnnotationBuilderDefaults } from "../lib/annotationBuilderDefaults";
import { isValidBuilderDefaults } from "../lib/annotationBuilderDefaults";

export type FoldingShowControls = "mouseover" | "always" | "never";

export type AnnotationDisplayMode = "pill" | "footnote";

export type BottomPanelPosition = "bottom" | "side";

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
  return "mindmap";
}

function applyDarkMode(val: unknown): DarkModePref {
  if (val === "light" || val === "dark" || val === "auto") return val;
  if (val === true) return "dark";
  if (val === false) return "light";
  return "auto";
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

export const usePreferencesStore = create<PreferencesState>((set) => ({
  darkMode: "auto",
  colorTheme: null,
  sidebarVisible: true,
  sidebarLocation: "left",
  defaultViewMode: "mindmap",
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
