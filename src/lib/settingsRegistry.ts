import type { PreferencesState } from "../stores/preferences";
import { DEFAULT_IMAGE_DIR } from "./imageSrcCandidates";
import { fuzzyMatch } from "./fuzzyMatch";

export const CATEGORIES = [
  "Appearance",
  "Editor",
  "Cross-references",
  "Annotations",
  "LLM",
  "Paper Search",
  "Academic Export",
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
  group?: string;
  /** Extra search-only terms; never rendered. Lets an entry surface for
   *  related queries whose words are absent from its visible label. */
  keywords?: string[];
  normalize?: (trimmed: string) => string;
  hint?: string;
}

interface ToggleEntry extends SettingEntryBase { controlType: "toggle"; }
interface SegmentedEntry extends SettingEntryBase { controlType: "segmented"; options: { value: string; label: string }[]; }
interface TextEntry extends SettingEntryBase { controlType: "text"; }
interface TextAreaEntry extends SettingEntryBase { controlType: "textarea"; }
interface DropdownEntry extends SettingEntryBase { controlType: "dropdown"; options?: { value: string; label: string }[]; }
export interface PasswordEntry extends SettingEntryBase { controlType: "password"; provider: string; }
interface SliderEntry extends SettingEntryBase { controlType: "slider"; min: number; max: number; step: number; }
/** Renders nothing itself (a dedicated component owns the UI). Exists purely
 *  to give a section a searchable anchor so search cannot hide it. */
interface PlaceholderEntry extends SettingEntryBase { controlType: "custom"; }

export type SettingEntry = ToggleEntry | SegmentedEntry | TextEntry | TextAreaEntry | DropdownEntry | PasswordEntry | SliderEntry | PlaceholderEntry;

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
  {
    category: "Appearance",
    label: "Default View Mode",
    storeField: "defaultViewMode",
    jsonKey: "workbench.defaultViewMode",
    controlType: "segmented",
    testId: "settings-defaultViewMode",
    options: [
      { value: "editor", label: "Editor" },
      { value: "mindmap", label: "Mindmap" },
      { value: "graph", label: "Graph" },
      { value: "cardbox", label: "Cardbox" },
    ],
  },
  {
    category: "Appearance",
    label: "Graph View",
    storeField: "graphViewEnabled",
    jsonKey: "workbench.graphView.enabled",
    controlType: "toggle",
    testId: "settings-graphViewEnabled",
    keywords: ["graph", "network", "sigma", "visualization"],
  },
  {
    category: "Appearance",
    label: "Auto-Reveal Active File in Sidebar",
    storeField: "autoRevealInSidebar",
    jsonKey: "workbench.autoRevealInSidebar",
    controlType: "toggle",
    testId: "settings-autoRevealInSidebar",
    keywords: ["reveal", "scroll", "sync", "follow", "track"],
  },
  {
    category: "Appearance",
    label: "Fonts",
    storeField: "fontInterfaceList",
    jsonKey: "appearance.interfaceFontList",
    controlType: "custom",
    testId: "settings-fonts",
    keywords: ["font", "typeface", "interface font", "text font", "monospace font", "font size", "font family", "manage fonts"],
  },
  {
    category: "Appearance",
    label: "Bottom Panel Position",
    storeField: "bottomPanelPosition",
    jsonKey: "workbench.bottomPanel.position",
    controlType: "segmented",
    testId: "settings-bottomPanelPosition",
    options: [
      { value: "bottom", label: "Bottom" },
      { value: "side", label: "Side" },
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
  {
    category: "Editor",
    label: "Companion Search Paths",
    storeField: "companionSearchPath",
    jsonKey: "companion.searchPath",
    controlType: "custom",
    testId: "settings-companionSearchPath",
    keywords: ["companion", "pdf", "search path", "sibling", "markdown", "directory"],
  },
  {
    category: "Editor",
    label: "Citation Notes Directory",
    storeField: "citationNotesDir",
    jsonKey: "citation.notesDir",
    controlType: "text",
    testId: "settings-citationNotesDir",
    keywords: ["citation", "references", "notes", "bibliography", "citekey", "directory"],
  },
  {
    category: "Editor",
    label: "Default Image Directory",
    storeField: "defaultImageDir",
    jsonKey: "editor.defaultImageDir",
    controlType: "text",
    testId: "settings-defaultImageDir",
    keywords: ["image", "images", "assets", "media", "pictures", "directory", "fallback"],
    normalize: (v) => v.trim() || DEFAULT_IMAGE_DIR,
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
    hint: "Applies to new resolutions; run Rebuild Index to refresh existing cards.",
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
  {
    category: "Annotations",
    label: "Pre-fill last-used values in builder",
    storeField: "annotationPrefillLastUsed",
    jsonKey: "annotations.prefillLastUsed",
    controlType: "toggle",
    testId: "settings-annotationPrefillLastUsed",
  },
  // LLM
  {
    category: "LLM",
    label: "LLM Provider",
    storeField: "llmProvider",
    jsonKey: "llm.provider",
    controlType: "custom",
    testId: "settings-llmProviderSearch",
    keywords: ["model", "api key", "openai", "anthropic", "gemini", "mistral", "base url", "provider"],
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
    label: "Neighbor Context Depth",
    storeField: "neighborsDepth",
    jsonKey: "llm.neighborsDepth",
    controlType: "slider",
    testId: "settings-neighborsDepth",
    min: 0,
    max: 2,
    step: 1,
  },
  {
    category: "LLM",
    label: "LLM Prompt",
    storeField: "llmPromptLlm",
    jsonKey: "llm.prompts.llm",
    controlType: "textarea",
    testId: "settings-llmPromptLlm",
    group: "Advanced",
  },
  {
    category: "LLM",
    label: "Translation Prompt",
    storeField: "llmPromptTr",
    jsonKey: "llm.prompts.tr",
    controlType: "textarea",
    testId: "settings-llmPromptTr",
    group: "Advanced",
  },
  {
    category: "LLM",
    label: "Question Prompt",
    storeField: "llmPromptQ",
    jsonKey: "llm.prompts.q",
    controlType: "textarea",
    testId: "settings-llmPromptQ",
    group: "Advanced",
  },
  // Academic Export
  {
    category: "Academic Export",
    label: "Pandoc Path",
    storeField: "academicPandocPath",
    jsonKey: "academic.pandocPath",
    controlType: "text",
    testId: "settings-academicPandocPath",
    nullable: true,
  },
  {
    category: "Academic Export",
    label: "Crossref Filter Path",
    storeField: "academicCrossrefPath",
    jsonKey: "academic.crossrefFilterPath",
    controlType: "text",
    testId: "settings-academicCrossrefPath",
    nullable: true,
  },
  {
    category: "Academic Export",
    label: "Default CSL Style",
    storeField: "academicDefaultCsl",
    jsonKey: "academic.defaultCsl",
    controlType: "dropdown",
    testId: "settings-academicDefaultCsl",
    options: [
      { value: "apa", label: "APA" },
      { value: "chicago-author-date", label: "Chicago (Author-Date)" },
      { value: "ieee", label: "IEEE" },
      { value: "vancouver", label: "Vancouver" },
      { value: "mla", label: "MLA" },
      { value: "acm-sig-proceedings", label: "ACM SIG Proceedings" },
      { value: "nature", label: "Nature" },
      { value: "harvard-cite-them-right", label: "Harvard" },
      { value: "american-medical-association", label: "AMA" },
      { value: "springer-basic-author-date", label: "Springer (Author-Date)" },
    ],
  },
  {
    category: "Academic Export",
    label: "Default Template Path",
    storeField: "academicDefaultTemplate",
    jsonKey: "academic.defaultTemplate",
    controlType: "text",
    testId: "settings-academicDefaultTemplate",
    nullable: true,
  },
  {
    category: "Academic Export",
    label: "Default Reference Doc Path",
    storeField: "academicDefaultReferenceDoc",
    jsonKey: "academic.defaultReferenceDoc",
    controlType: "text",
    testId: "settings-academicDefaultReferenceDoc",
    nullable: true,
  },
  {
    category: "Academic Export",
    label: "Indic Font",
    storeField: "academicIndicFont",
    jsonKey: "academic.indicFont",
    controlType: "text",
    testId: "settings-academicIndicFont",
    nullable: true,
    keywords: ["devanagari", "hindi", "sanskrit", "bengali", "tamil", "telugu",
               "kannada", "malayalam", "gujarati", "gurmukhi", "oriya", "sinhala",
               "thai", "khmer", "lao", "myanmar", "tibetan", "indic", "font"],
  },
  // Paper Search
  {
    category: "Paper Search",
    label: "Search Providers",
    storeField: "searchEnabledProviders",
    jsonKey: "search.enabledProviders",
    controlType: "custom",
    testId: "settings-searchProviders",
    keywords: ["provider", "search", "paper", "academic", "enable", "disable", "openalex", "crossref", "pubmed", "semantic scholar", "unpaywall", "core", "openreview", "arxiv", "biorxiv"],
  },
  {
    category: "Paper Search",
    label: "Crossref Email",
    storeField: "searchCrossrefEmail",
    jsonKey: "search.crossrefEmail",
    controlType: "text",
    testId: "settings-searchCrossrefEmail",
    keywords: ["crossref", "polite pool", "email", "contact"],
  },
  {
    category: "Paper Search",
    label: "Unpaywall Email",
    storeField: "searchUnpaywallEmail",
    jsonKey: "search.unpaywallEmail",
    controlType: "text",
    testId: "settings-searchUnpaywallEmail",
    keywords: ["unpaywall", "open access", "email", "contact"],
  },
  {
    category: "Paper Search",
    label: "Semantic Scholar API Key",
    storeField: "searchS2ApiKeySet",
    jsonKey: "search.s2ApiKey",
    controlType: "password",
    testId: "settings-searchS2ApiKey",
    provider: "semantic-scholar",
    keywords: ["semantic scholar", "s2", "api key"],
  },
  {
    category: "Paper Search",
    label: "CORE API Key",
    storeField: "searchCoreApiKeySet",
    jsonKey: "search.coreApiKey",
    controlType: "password",
    testId: "settings-searchCoreApiKey",
    provider: "core",
    keywords: ["core", "api key", "core.ac.uk"],
  },
  {
    category: "Paper Search",
    label: "PubMed API Key",
    storeField: "searchPubmedApiKeySet",
    jsonKey: "search.pubmedApiKey",
    controlType: "password",
    testId: "settings-searchPubmedApiKey",
    provider: "pubmed",
    keywords: ["pubmed", "ncbi", "api key", "entrez"],
  },
  {
    category: "Paper Search",
    label: "Google Books API Key",
    storeField: "searchGoogleBooksApiKeySet",
    jsonKey: "search.googleBooksApiKey",
    controlType: "password",
    testId: "settings-searchGoogleBooksApiKey",
    provider: "google-books",
    keywords: ["google books", "api key", "books"],
  },
  {
    category: "Paper Search",
    label: "BASE API Key",
    storeField: "searchBaseApiKeySet",
    jsonKey: "search.baseApiKey",
    controlType: "password",
    testId: "settings-searchBaseApiKey",
    provider: "base",
    keywords: ["base", "bielefeld", "api key"],
  },
  {
    category: "Paper Search",
    label: "Provider Timeout",
    storeField: "searchProviderTimeout",
    jsonKey: "search.providerTimeout",
    controlType: "slider",
    testId: "settings-searchProviderTimeout",
    min: 5,
    max: 60,
    step: 5,
    keywords: ["timeout", "seconds", "request"],
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
    const labelMatch = fuzzyMatch(query, entry.label);
    let bestScore = labelMatch ? labelMatch.score : -1;
    // Keyword matches only affect inclusion/sorting — their indices reference
    // the keyword string, not entry.label, so we never expose them for
    // highlighting. Use label indices when the label matched, else [].
    for (const keyword of entry.keywords ?? []) {
      const kwMatch = fuzzyMatch(query, keyword);
      if (kwMatch && kwMatch.score > bestScore) bestScore = kwMatch.score;
    }
    if (bestScore >= 0) {
      results.push({ entry, indices: labelMatch ? labelMatch.indices : [], score: bestScore });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.map(({ entry, indices }) => ({ entry, indices }));
}
