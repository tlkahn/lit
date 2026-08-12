import type { PreferencesState } from "../stores/preferences";
import { normalizeLang } from "./annotationLang";
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
  /**
   * When false, the entry is omitted from the Settings form and search.
   * Preference key/default/store wiring stays; Edit JSON remains the escape
   * hatch. Default: false for new entries unless intentionally productized in
   * the form. Set explicitly on every entry so the policy is grep-able.
   */
  formVisible?: boolean;
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
    formVisible: true,
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
    formVisible: true,
    label: "Color Theme",
    storeField: "colorTheme",
    jsonKey: "workbench.colorTheme",
    controlType: "dropdown",
    testId: "settings-colorTheme",
    nullable: true,
  },
  {
    category: "Appearance",
    formVisible: false,
    label: "Sidebar Visible",
    storeField: "sidebarVisible",
    jsonKey: "workbench.sideBar.visible",
    controlType: "toggle",
    testId: "settings-sidebarVisible",
  },
  {
    category: "Appearance",
    formVisible: false,
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
    formVisible: false,
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
    formVisible: false,
    label: "Graph View",
    storeField: "graphViewEnabled",
    jsonKey: "workbench.graphView.enabled",
    controlType: "toggle",
    testId: "settings-graphViewEnabled",
    keywords: ["graph", "network", "sigma", "visualization"],
  },
  {
    category: "Appearance",
    formVisible: false,
    label: "Auto-Reveal Active File in Sidebar",
    storeField: "autoRevealInSidebar",
    jsonKey: "workbench.autoRevealInSidebar",
    controlType: "toggle",
    testId: "settings-autoRevealInSidebar",
    keywords: ["reveal", "scroll", "sync", "follow", "track"],
  },
  {
    category: "Appearance",
    formVisible: true,
    label: "Fonts",
    storeField: "fontInterfaceList",
    jsonKey: "appearance.interfaceFontList",
    controlType: "custom",
    testId: "settings-fonts",
    keywords: ["font", "typeface", "interface font", "text font", "monospace font", "font size", "font family", "manage fonts"],
  },
  {
    category: "Appearance",
    formVisible: false,
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
    formVisible: false,
    label: "Folding",
    storeField: "foldingEnabled",
    jsonKey: "editor.folding.enabled",
    controlType: "toggle",
    testId: "settings-foldingEnabled",
  },
  {
    category: "Editor",
    formVisible: false,
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
    formVisible: false,
    label: "Media Thumbnails",
    storeField: "mediaThumbnails",
    jsonKey: "editor.mediaThumbnails",
    controlType: "toggle",
    testId: "settings-mediaThumbnails",
  },
  {
    category: "Editor",
    formVisible: false,
    label: "Companion Search Paths",
    storeField: "companionSearchPath",
    jsonKey: "companion.searchPath",
    controlType: "custom",
    testId: "settings-companionSearchPath",
    keywords: ["companion", "pdf", "search path", "sibling", "markdown", "directory"],
  },
  {
    category: "Editor",
    formVisible: false,
    label: "Citation Notes Directory",
    storeField: "citationNotesDir",
    jsonKey: "citation.notesDir",
    controlType: "text",
    testId: "settings-citationNotesDir",
    keywords: ["citation", "references", "notes", "bibliography", "citekey", "directory"],
  },
  {
    category: "Editor",
    formVisible: false,
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
    formVisible: false,
    label: "Enabled",
    storeField: "crossrefEnabled",
    jsonKey: "crossref.enabled",
    controlType: "toggle",
    testId: "settings-crossrefEnabled",
  },
  {
    category: "Cross-references",
    formVisible: false,
    label: "Live Rendering",
    storeField: "crossrefLiveRendering",
    jsonKey: "crossref.liveRendering",
    controlType: "toggle",
    testId: "settings-crossrefLiveRendering",
  },
  {
    category: "Cross-references",
    formVisible: false,
    label: "Enable Citeproc",
    storeField: "crossrefEnableCiteproc",
    jsonKey: "crossref.enableCiteproc",
    controlType: "toggle",
    testId: "settings-crossrefEnableCiteproc",
  },
  // Annotations
  {
    category: "Annotations",
    formVisible: false,
    label: "Enabled",
    storeField: "annotationEnabled",
    jsonKey: "annotations.enabled",
    controlType: "toggle",
    testId: "settings-annotationEnabled",
  },
  {
    category: "Annotations",
    formVisible: false,
    label: "Scope Highlight",
    storeField: "annotationScopeHighlight",
    jsonKey: "annotations.scopeHighlight",
    controlType: "toggle",
    testId: "settings-annotationScopeHighlight",
  },
  {
    category: "Annotations",
    formVisible: false,
    label: "Default Language",
    storeField: "annotationDefaultLang",
    jsonKey: "annotations.defaultLang",
    controlType: "text",
    testId: "settings-annotationDefaultLang",
    normalize: (v) => normalizeLang(v) ?? "en",
    hint: "Applies to new resolutions; run Rebuild Index to refresh existing cards.",
  },
  {
    category: "Annotations",
    formVisible: false,
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
    formVisible: false,
    label: "Pre-fill last-used values in builder",
    storeField: "annotationPrefillLastUsed",
    jsonKey: "annotations.prefillLastUsed",
    controlType: "toggle",
    testId: "settings-annotationPrefillLastUsed",
  },
  // LLM
  {
    category: "LLM",
    formVisible: false,
    label: "LLM Provider",
    storeField: "llmProvider",
    jsonKey: "llm.provider",
    controlType: "custom",
    testId: "settings-llmProviderSearch",
    keywords: ["model", "api key", "openai", "anthropic", "gemini", "mistral", "base url", "provider"],
  },
  {
    category: "LLM",
    formVisible: false,
    label: "System Prompt",
    storeField: "llmSystemPrompt",
    jsonKey: "llm.systemPrompt",
    controlType: "textarea",
    testId: "settings-llmSystemPrompt",
  },
  {
    category: "LLM",
    formVisible: false,
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
    formVisible: false,
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
    formVisible: false,
    label: "LLM Prompt",
    storeField: "llmPromptLlm",
    jsonKey: "llm.prompts.llm",
    controlType: "textarea",
    testId: "settings-llmPromptLlm",
    group: "Advanced",
  },
  {
    category: "LLM",
    formVisible: false,
    label: "Translation Prompt",
    storeField: "llmPromptTr",
    jsonKey: "llm.prompts.tr",
    controlType: "textarea",
    testId: "settings-llmPromptTr",
    group: "Advanced",
  },
  {
    category: "LLM",
    formVisible: false,
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
    formVisible: false,
    label: "Pandoc Path",
    storeField: "academicPandocPath",
    jsonKey: "academic.pandocPath",
    controlType: "text",
    testId: "settings-academicPandocPath",
    nullable: true,
  },
  {
    category: "Academic Export",
    formVisible: false,
    label: "Crossref Filter Path",
    storeField: "academicCrossrefPath",
    jsonKey: "academic.crossrefFilterPath",
    controlType: "text",
    testId: "settings-academicCrossrefPath",
    nullable: true,
  },
  {
    category: "Academic Export",
    formVisible: false,
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
    formVisible: false,
    label: "Default Template Path",
    storeField: "academicDefaultTemplate",
    jsonKey: "academic.defaultTemplate",
    controlType: "text",
    testId: "settings-academicDefaultTemplate",
    nullable: true,
  },
  {
    category: "Academic Export",
    formVisible: false,
    label: "Default Reference Doc Path",
    storeField: "academicDefaultReferenceDoc",
    jsonKey: "academic.defaultReferenceDoc",
    controlType: "text",
    testId: "settings-academicDefaultReferenceDoc",
    nullable: true,
  },
  {
    category: "Academic Export",
    formVisible: false,
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
    formVisible: false,
    label: "Search Providers",
    storeField: "searchEnabledProviders",
    jsonKey: "search.enabledProviders",
    controlType: "custom",
    testId: "settings-searchProviders",
    keywords: ["provider", "search", "paper", "academic", "enable", "disable", "openalex", "crossref", "pubmed", "semantic scholar", "unpaywall", "core", "openreview", "arxiv", "biorxiv"],
  },
  {
    category: "Paper Search",
    formVisible: false,
    label: "Crossref Email",
    storeField: "searchCrossrefEmail",
    jsonKey: "search.crossrefEmail",
    controlType: "text",
    testId: "settings-searchCrossrefEmail",
    keywords: ["crossref", "polite pool", "email", "contact"],
  },
  {
    category: "Paper Search",
    formVisible: false,
    label: "Unpaywall Email",
    storeField: "searchUnpaywallEmail",
    jsonKey: "search.unpaywallEmail",
    controlType: "text",
    testId: "settings-searchUnpaywallEmail",
    keywords: ["unpaywall", "open access", "email", "contact"],
  },
  {
    category: "Paper Search",
    formVisible: false,
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
    formVisible: false,
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
    formVisible: false,
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
    formVisible: false,
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
    formVisible: false,
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
    formVisible: false,
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
    formVisible: false,
    label: "Unlinked References",
    storeField: "experimentalUnlinkedReferences",
    jsonKey: "experimental.unlinkedReferences",
    controlType: "toggle",
    testId: "settings-experimentalUnlinkedReferences",
  },
];

/** Entries surfaced in the Settings form; everything else is Edit JSON only. */
export const FORM_SETTINGS_REGISTRY: SettingEntry[] =
  SETTINGS_REGISTRY.filter((e) => e.formVisible);

/** Sidebar tabs that still have a form surface (plus Keyboard Shortcuts). */
export const FORM_CATEGORIES = [
  "Appearance",
  "Keyboard Shortcuts",
] as const satisfies readonly Category[];

export type FormCategory = (typeof FORM_CATEGORIES)[number];

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

/** Filter against the form-visible subset only (search never re-surfaces hidden knobs). */
export function filterFormSettings(query: string): FilteredSetting[] {
  return filterSettings(FORM_SETTINGS_REGISTRY, query);
}
