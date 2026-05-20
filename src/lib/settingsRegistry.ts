import type { PreferencesState } from "../stores/preferences";
import { fuzzyMatch } from "./fuzzyMatch";

export const CATEGORIES = [
  "Appearance",
  "Editor",
  "Cross-references",
  "Annotations",
  "LLM",
  "Experimental",
  "Keyboard Shortcuts",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type PreferenceField = Exclude<keyof PreferencesState, "loaded" | "loadPreferences">;

interface SettingEntryBase {
  category: Category;
  label: string;
  storeField: PreferenceField;
  jsonKey: string;
  testId: string;
  nullable?: boolean;
}

interface ToggleEntry extends SettingEntryBase { controlType: "toggle"; }
interface SegmentedEntry extends SettingEntryBase { controlType: "segmented"; options: { value: string; label: string }[]; }
interface TextEntry extends SettingEntryBase { controlType: "text"; }
interface TextAreaEntry extends SettingEntryBase { controlType: "textarea"; }
interface DropdownEntry extends SettingEntryBase { controlType: "dropdown"; options?: { value: string; label: string }[]; }
interface PasswordEntry extends SettingEntryBase { controlType: "password"; provider: string; }
interface SliderEntry extends SettingEntryBase { controlType: "slider"; min: number; max: number; step: number; }

export type SettingEntry = ToggleEntry | SegmentedEntry | TextEntry | TextAreaEntry | DropdownEntry | PasswordEntry | SliderEntry;

export const SETTINGS_REGISTRY: SettingEntry[] = [
  // Appearance
  {
    category: "Appearance",
    label: "Dark Mode",
    storeField: "darkMode",
    jsonKey: "workbench.darkMode",
    controlType: "segmented",
    testId: "settings-darkMode",
    options: [
      { value: "auto", label: "Auto" },
      { value: "dark", label: "Dark" },
      { value: "light", label: "Light" },
    ],
  },
  {
    category: "Appearance",
    label: "Color Theme",
    storeField: "colorTheme",
    jsonKey: "workbench.colorTheme",
    controlType: "dropdown",
    testId: "settings-colorTheme",
    nullable: true,
  },
  {
    category: "Appearance",
    label: "Sidebar Visible",
    storeField: "sidebarVisible",
    jsonKey: "workbench.sideBar.visible",
    controlType: "toggle",
    testId: "settings-sidebarVisible",
  },
  {
    category: "Appearance",
    label: "Sidebar Location",
    storeField: "sidebarLocation",
    jsonKey: "workbench.sideBar.location",
    controlType: "segmented",
    testId: "settings-sidebarLocation",
    options: [
      { value: "left", label: "Left" },
      { value: "right", label: "Right" },
    ],
  },
  // Editor
  {
    category: "Editor",
    label: "Folding",
    storeField: "foldingEnabled",
    jsonKey: "editor.folding.enabled",
    controlType: "toggle",
    testId: "settings-foldingEnabled",
  },
  {
    category: "Editor",
    label: "Folding Controls",
    storeField: "foldingShowControls",
    jsonKey: "editor.folding.showFoldingControls",
    controlType: "segmented",
    testId: "settings-foldingShowControls",
    options: [
      { value: "mouseover", label: "Mouseover" },
      { value: "always", label: "Always" },
      { value: "never", label: "Never" },
    ],
  },
  {
    category: "Editor",
    label: "Media Thumbnails",
    storeField: "mediaThumbnails",
    jsonKey: "editor.mediaThumbnails",
    controlType: "toggle",
    testId: "settings-mediaThumbnails",
  },
  // Cross-references
  {
    category: "Cross-references",
    label: "Enabled",
    storeField: "crossrefEnabled",
    jsonKey: "crossref.enabled",
    controlType: "toggle",
    testId: "settings-crossrefEnabled",
  },
  {
    category: "Cross-references",
    label: "Live Rendering",
    storeField: "crossrefLiveRendering",
    jsonKey: "crossref.liveRendering",
    controlType: "toggle",
    testId: "settings-crossrefLiveRendering",
  },
  {
    category: "Cross-references",
    label: "Enable Citeproc",
    storeField: "crossrefEnableCiteproc",
    jsonKey: "crossref.enableCiteproc",
    controlType: "toggle",
    testId: "settings-crossrefEnableCiteproc",
  },
  // Annotations
  {
    category: "Annotations",
    label: "Enabled",
    storeField: "annotationEnabled",
    jsonKey: "annotations.enabled",
    controlType: "toggle",
    testId: "settings-annotationEnabled",
  },
  {
    category: "Annotations",
    label: "Scope Highlight",
    storeField: "annotationScopeHighlight",
    jsonKey: "annotations.scopeHighlight",
    controlType: "toggle",
    testId: "settings-annotationScopeHighlight",
  },
  {
    category: "Annotations",
    label: "Default Language",
    storeField: "annotationDefaultLang",
    jsonKey: "annotations.defaultLang",
    controlType: "text",
    testId: "settings-annotationDefaultLang",
  },
  {
    category: "Annotations",
    label: "Display Mode",
    storeField: "annotationDisplayMode",
    jsonKey: "annotations.displayMode",
    controlType: "segmented",
    testId: "settings-annotationDisplayMode",
    options: [
      { value: "pill", label: "Pill" },
      { value: "footnote", label: "Footnote" },
    ],
  },
  // LLM
  {
    category: "LLM",
    label: "Model",
    storeField: "llmModel",
    jsonKey: "llm.model",
    controlType: "dropdown",
    testId: "settings-llmModel",
    options: [
      { value: "claude-opus-4-6", label: "Claude Opus" },
      { value: "claude-sonnet-4-6", label: "Claude Sonnet" },
      { value: "claude-haiku-4-5", label: "Claude Haiku" },
      { value: "gpt-4o", label: "GPT-4o" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    ],
  },
  {
    category: "LLM",
    label: "OpenAI API Key",
    storeField: "llmOpenaiApiKeySet",
    jsonKey: "",
    controlType: "password",
    testId: "settings-llmOpenaiApiKeySet",
    provider: "openai",
  },
  {
    category: "LLM",
    label: "OpenAI Base URL",
    storeField: "llmOpenaiBaseUrl",
    jsonKey: "llm.openai.baseUrl",
    controlType: "text",
    testId: "settings-llmOpenaiBaseUrl",
  },
  {
    category: "LLM",
    label: "Anthropic API Key",
    storeField: "llmAnthropicApiKeySet",
    jsonKey: "",
    controlType: "password",
    testId: "settings-llmAnthropicApiKeySet",
    provider: "anthropic",
  },
  {
    category: "LLM",
    label: "Anthropic Base URL",
    storeField: "llmAnthropicBaseUrl",
    jsonKey: "llm.anthropic.baseUrl",
    controlType: "text",
    testId: "settings-llmAnthropicBaseUrl",
  },
  {
    category: "LLM",
    label: "System Prompt",
    storeField: "llmSystemPrompt",
    jsonKey: "llm.systemPrompt",
    controlType: "textarea",
    testId: "settings-llmSystemPrompt",
  },
  {
    category: "LLM",
    label: "Temperature",
    storeField: "llmTemperature",
    jsonKey: "llm.temperature",
    controlType: "slider",
    testId: "settings-llmTemperature",
    min: 0,
    max: 2,
    step: 0.1,
  },
  {
    category: "LLM",
    label: "LLM Prompt",
    storeField: "llmPromptLlm",
    jsonKey: "llm.prompts.llm",
    controlType: "textarea",
    testId: "settings-llmPromptLlm",
  },
  {
    category: "LLM",
    label: "Todo Prompt",
    storeField: "llmPromptTodo",
    jsonKey: "llm.prompts.todo",
    controlType: "textarea",
    testId: "settings-llmPromptTodo",
  },
  {
    category: "LLM",
    label: "Translation Prompt",
    storeField: "llmPromptTr",
    jsonKey: "llm.prompts.tr",
    controlType: "textarea",
    testId: "settings-llmPromptTr",
  },
  {
    category: "LLM",
    label: "Question Prompt",
    storeField: "llmPromptQ",
    jsonKey: "llm.prompts.q",
    controlType: "textarea",
    testId: "settings-llmPromptQ",
  },
  {
    category: "LLM",
    label: "Note Prompt",
    storeField: "llmPromptN",
    jsonKey: "llm.prompts.n",
    controlType: "textarea",
    testId: "settings-llmPromptN",
  },
  {
    category: "LLM",
    label: "Cross-ref Prompt",
    storeField: "llmPromptCf",
    jsonKey: "llm.prompts.cf",
    controlType: "textarea",
    testId: "settings-llmPromptCf",
  },
  {
    category: "LLM",
    label: "Apparatus Prompt",
    storeField: "llmPromptApp",
    jsonKey: "llm.prompts.app",
    controlType: "textarea",
    testId: "settings-llmPromptApp",
  },
  // Experimental
  {
    category: "Experimental",
    label: "Unlinked References",
    storeField: "experimentalUnlinkedReferences",
    jsonKey: "experimental.unlinkedReferences",
    controlType: "toggle",
    testId: "settings-experimentalUnlinkedReferences",
  },
];

export const STORE_FIELDS: PreferenceField[] = SETTINGS_REGISTRY.map(e => e.storeField);

export interface FilteredSetting {
  entry: SettingEntry;
  indices: number[];
}

export function groupByCategory(
  entries: SettingEntry[],
): Map<Category, SettingEntry[]> {
  const map = new Map<Category, SettingEntry[]>();
  for (const cat of CATEGORIES) {
    map.set(cat, []);
  }
  for (const entry of entries) {
    map.get(entry.category)!.push(entry);
  }
  return map;
}

export function filterSettings(
  entries: SettingEntry[],
  query: string,
): FilteredSetting[] {
  if (query === "") {
    return entries.map((entry) => ({ entry, indices: [] }));
  }
  const results: (FilteredSetting & { score: number })[] = [];
  for (const entry of entries) {
    const match = fuzzyMatch(query, entry.label);
    if (match) {
      results.push({ entry, indices: match.indices, score: match.score });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.map(({ entry, indices }) => ({ entry, indices }));
}
