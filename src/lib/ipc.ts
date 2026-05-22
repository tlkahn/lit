import { invoke } from "@tauri-apps/api/core";

export interface AppInfo {
  name: string;
  version: string;
}

export interface PageMeta {
  title: string;
  relative_path: string;
  frontmatter: Record<string, unknown>;
  created_at: number | null;
  modified_at: number | null;
  file_type: 'markdown' | 'pdf';
}

export interface PageContent {
  meta: PageMeta;
  body: string;
  raw_yaml: string;
}

export interface FileEvent {
  path: string;
}

export async function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("get_app_info");
}

export async function openWorkspace(path: string): Promise<PageMeta[]> {
  return invoke<PageMeta[]>("open_workspace", { path });
}

export async function listPages(): Promise<PageMeta[]> {
  return invoke<PageMeta[]>("list_pages");
}

export async function getWorkspacePath(): Promise<string | null> {
  return invoke<string | null>("get_workspace_path");
}

export async function readPage(relativePath: string): Promise<PageContent> {
  return invoke<PageContent>("read_page", { relativePath });
}

export async function writePage(
  relativePath: string,
  body: string,
  frontmatter: Record<string, unknown>,
): Promise<void> {
  return invoke<void>("write_page", { relativePath, body, frontmatter });
}

export async function createPage(name: string, parentDir?: string): Promise<PageMeta> {
  return invoke<PageMeta>("create_page", { name, parentDir: parentDir ?? null });
}

export async function renamePage(oldPath: string, newName: string): Promise<string> {
  return invoke<string>("rename_page", { oldPath, newName });
}

export async function deletePage(relativePath: string): Promise<void> {
  return invoke<void>("delete_page", { relativePath });
}

export async function acknowledgeFileHash(relativePath: string): Promise<void> {
  return invoke<void>("acknowledge_file_hash", { relativePath });
}

export async function parseRawYaml(rawYaml: string): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("parse_raw_yaml", { rawYaml });
}

export interface StartupContext {
  workspace: string | null;
  file: string | null;
  line: number | null;
  col: number | null;
}

export async function getStartupContext(): Promise<StartupContext> {
  return invoke<StartupContext>("get_startup_context");
}

export async function openWorkspaceWindow(path?: string): Promise<string> {
  return invoke<string>("open_workspace_window", { path: path ?? null });
}

export async function installCli(): Promise<void> {
  return invoke<void>("install_cli");
}

export async function uninstallCli(): Promise<void> {
  return invoke<void>("uninstall_cli");
}

export async function isCliInstalled(): Promise<boolean> {
  return invoke<boolean>("is_cli_installed");
}

// Theme commands

export interface ThemeInfo {
  name: string;
  version: string;
  author: string;
  directory_name: string;
}

export async function listThemes(): Promise<ThemeInfo[]> {
  return invoke<ThemeInfo[]>("list_themes");
}

export async function readThemeCss(directoryName: string): Promise<string> {
  return invoke<string>("read_theme_css", { directoryName });
}

export async function getThemesDirectory(): Promise<string> {
  return invoke<string>("get_themes_directory");
}

// Keymap commands

export type KeyBindingSource = "default" | "user" | "menu";

export interface KeyBinding {
  key: string;
  command: string;
  when?: string;
  source?: KeyBindingSource;
}

export async function getKeymaps(): Promise<KeyBinding[]> {
  return invoke<KeyBinding[]>("get_keymaps");
}

export async function getDefaultKeymaps(): Promise<KeyBinding[]> {
  return invoke<KeyBinding[]>("get_default_keymaps");
}

export async function getUserKeymapsPath(): Promise<string> {
  return invoke<string>("get_user_keymaps_path");
}

export async function saveUserKeymaps(bindings: KeyBinding[]): Promise<void> {
  return invoke<void>("save_user_keymaps", { bindings });
}

export async function getMenuShortcuts(): Promise<KeyBinding[]> {
  return invoke<KeyBinding[]>("get_menu_shortcuts");
}

// Preferences commands

export type DarkModePref = "light" | "dark" | "auto";

export interface Preferences {
  "workbench.colorTheme": string | null;
  "workbench.darkMode": DarkModePref;
  "workbench.sideBar.location": string;
  "editor.folding.enabled": boolean;
  "editor.folding.showFoldingControls": string;
  [key: string]: unknown;
}

export async function getPreferences(): Promise<Preferences> {
  return invoke<Preferences>("get_preferences");
}

export async function getPreferencesPath(): Promise<string> {
  return invoke<string>("get_preferences_path");
}

export async function setPreference(key: string, value: unknown): Promise<void> {
  return invoke<void>("set_preference", { key, value });
}

export async function getPreferencesRaw(): Promise<string> {
  return invoke<string>("get_preferences_raw");
}

export async function setPreferencesRaw(json: string): Promise<void> {
  return invoke<void>("set_preferences_raw", { json });
}

// Credential commands

export async function setApiKey(provider: string, key: string): Promise<void> {
  return invoke<void>("set_api_key", { provider, key });
}

export async function getApiKey(provider: string): Promise<string> {
  return invoke<string>("get_api_key", { provider });
}

export async function hasApiKey(provider: string): Promise<boolean> {
  return invoke<boolean>("has_api_key", { provider });
}

export async function deleteApiKey(provider: string): Promise<void> {
  return invoke<void>("delete_api_key", { provider });
}

// LLM commands

export interface LlmPromptStreamingArgs {
  model: string;
  text: string;
  system?: string;
  messages?: Array<{ role: string; content: string }>;
  options?: Record<string, unknown>;
  baseUrl?: string;
  apiKey?: string;
}

export async function llmPromptStreaming(args: LlmPromptStreamingArgs): Promise<void> {
  return invoke<void>("llm_prompt_streaming", {
    args: {
      model: args.model,
      text: args.text,
      system: args.system ?? null,
      messages: args.messages ?? [],
      options: args.options ?? {},
      base_url: args.baseUrl ?? null,
      api_key: args.apiKey ?? null,
    },
  });
}

export async function llmCancel(): Promise<void> {
  return invoke<void>("llm_cancel");
}

export async function testLlmConnection(
  model: string,
  baseUrl?: string,
): Promise<void> {
  return invoke<void>("llm_test_connection", {
    model,
    baseUrl: baseUrl ?? null,
  });
}

// Crossref commands

export interface ResolvedCitation {
  char_start: number;
  char_end: number;
  rendered_text: string;
  is_valid: boolean;
  original: string;
  target_line: number | null;
  target_char_offset: number | null;
}

export interface ResolvedDefinitionTag {
  char_start: number;
  char_end: number;
  rendered_text: string;
  is_valid: boolean;
  original: string;
  ref_type: string;
  id: string;
}

export interface AllDecorations {
  citations: ResolvedCitation[];
  definition_tags: ResolvedDefinitionTag[];
}

export interface DefinitionInfo {
  ref_type: string;
  id: string;
  number: unknown;
  caption: string | null;
  line: number;
  char_offset: number;
}

export interface BibEntry {
  key: string;
  authors: string[];
  title: string;
  year: string;
  entry_type: string;
  line_number: number;
  bib_file?: string;
}

export async function resolveAllDecorations(
  content: string,
  frontmatter?: Record<string, unknown>,
): Promise<AllDecorations> {
  return invoke<AllDecorations>("resolve_all_decorations", {
    content,
    frontmatter: frontmatter ?? null,
  });
}

export async function getDefinitions(
  content: string,
  frontmatter?: Record<string, unknown>,
): Promise<DefinitionInfo[]> {
  return invoke<DefinitionInfo[]>("get_definitions", {
    content,
    frontmatter: frontmatter ?? null,
  });
}

export async function expandTemplate(
  template: string,
  filename?: string,
  index?: number,
  ext?: string,
): Promise<string> {
  return invoke<string>("expand_template", {
    template,
    filename: filename ?? null,
    index: index ?? null,
    ext: ext ?? null,
  });
}

export async function resolveBibEntries(
  bibPaths: string[],
  noteDir: string,
): Promise<BibEntry[]> {
  return invoke<BibEntry[]>("resolve_bib_entries", { bibPaths, noteDir });
}

export async function renderBibCitations(
  entries: BibEntry[],
): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("render_bib_citations", { entries });
}

// Graph

export interface BacklinkEntry {
  source_id: string;
  source_title: string;
  context: string;
  source_line: number;
}

export interface LinkEntry {
  target_id: string;
  target_title: string;
  raw_target: string;
  context: string;
}

export interface GraphNode {
  id: string;
  title: string;
  is_stub: boolean;
}

export interface SubgraphResult {
  nodes: GraphNode[];
  edges: [string, string][];
  pagerank?: Record<string, number>;
  positions?: Record<string, { x: number; y: number; z: number }>;
}

export interface GraphStats {
  nodes: number;
  stubs: number;
  edges: number;
  tags: number;
}

export interface GraphSearchResult {
  id: string;
  title: string;
  score: number;
  excerpt: string;
  first_match_line?: number;
}

export async function getBacklinks(pageId: string): Promise<BacklinkEntry[]> {
  return invoke<BacklinkEntry[]>("get_backlinks", { pageId });
}

export async function getForwardLinks(pageId: string): Promise<LinkEntry[]> {
  return invoke<LinkEntry[]>("get_forward_links", { pageId });
}

export async function searchPages(query: string, limit?: number): Promise<GraphSearchResult[]> {
  return invoke<GraphSearchResult[]>("search_pages", { query, limit: limit ?? null });
}

export async function searchPagesByTitle(query: string, limit?: number): Promise<GraphSearchResult[]> {
  return invoke<GraphSearchResult[]>("search_pages_by_title", { query, limit: limit ?? null });
}

export async function getGraphStats(): Promise<GraphStats> {
  return invoke<GraphStats>("get_graph_stats");
}

export async function getGraphNeighbors(
  id: string,
  depth: number,
  directed?: boolean,
): Promise<SubgraphResult> {
  return invoke<SubgraphResult>("get_graph_neighbors", { id, depth, directed: directed ?? null });
}

export async function getGraphPaths(
  from: string,
  to: string,
  maxDepth: number,
  directed?: boolean,
): Promise<string[][]> {
  return invoke<string[][]>("get_graph_paths", { from, to, maxDepth, directed: directed ?? null });
}

export async function getGraphSubgraph(
  seeds: string[],
  depth: number,
  directed?: boolean,
): Promise<SubgraphResult> {
  return invoke<SubgraphResult>("get_graph_subgraph", { seeds, depth, directed: directed ?? null });
}

export async function getFullSubgraph(): Promise<SubgraphResult> {
  return invoke<SubgraphResult>("get_graph_subgraph", { seeds: [], depth: 0, directed: null });
}

export interface ResolvedWikilink {
  target: string;
  node_id: string | null;
  tier: string;
}

export async function resolveWikilink(target: string): Promise<ResolvedWikilink> {
  return invoke<ResolvedWikilink>("resolve_wikilink", { target });
}

export interface HeadingInfo {
  text: string;
  level: number;
}

export async function getPageHeadings(target: string): Promise<HeadingInfo[]> {
  return invoke<HeadingInfo[]>("get_page_headings", { target });
}

export async function rebuildGraphIndex(): Promise<string> {
  return invoke<string>("rebuild_graph_index");
}

export async function resetGraphLayout(): Promise<void> {
  return invoke<void>("reset_graph_layout");
}

export interface Layout3dSettings {
  epochs?: number;
  epsilon?: number;
  random_seed?: number | null;
}

export async function computeLayout3d(settings?: Layout3dSettings): Promise<void> {
  return invoke<void>("compute_layout_3d", { settings: settings ?? null });
}

export async function getPagerank(): Promise<Record<string, number>>;
export async function getPagerank(n: number): Promise<[string, number][]>;
export async function getPagerank(n?: number) {
  return invoke("get_pagerank", { n: n ?? null });
}

// Unlinked mentions

export interface UnlinkedMention {
  source_id: string;
  source_title: string;
  context: string;
  source_line: number;
  matched_text: string;
}

export async function getUnlinkedMentions(pageId: string): Promise<UnlinkedMention[]> {
  return invoke<UnlinkedMention[]>("get_unlinked_mentions", { pageId });
}

export async function linkUnlinkedMention(
  sourceId: string,
  sourceLine: number,
  matchedText: string,
): Promise<void> {
  return invoke<void>("link_unlinked_mention", { sourceId, sourceLine, matchedText });
}

// Index progress

export type IndexPhase = "scanning" | "parsing" | "resolving" | "diffing" | "building";

export interface IndexProgress {
  phase: IndexPhase;
  current: number;
  total: number;
}

export interface TagSearchResult {
  tag: string;
  count: number;
}

export interface TagPageResult {
  id: string;
  title: string;
  first_paragraph: string;
}

export async function searchTags(query: string, limit?: number): Promise<TagSearchResult[]> {
  return invoke<TagSearchResult[]>("search_tags", { query, limit: limit ?? null });
}

export async function listPagesByTag(tag: string, limit?: number): Promise<TagPageResult[]> {
  return invoke<TagPageResult[]>("list_pages_by_tag", { tag, limit: limit ?? null });
}

export async function getGraphPositions(): Promise<Record<string, { x: number; y: number; z: number }>> {
  return invoke<Record<string, { x: number; y: number; z: number }>>("get_graph_positions");
}

export async function ensureGraphReady(path: string): Promise<void> {
  return invoke<void>("ensure_graph_ready", { path });
}

// PDF viewer

export interface PdfInfo {
  page_count: number;
  path: string;
}

export interface RenderedPage {
  page_index: number;
  png_path: string;
  width: number;
  height: number;
}

export async function pdfOpen(path: string): Promise<PdfInfo> {
  return invoke<PdfInfo>("pdf_open", { path });
}

export async function pdfRenderPage(pageIndex: number, dpi: number): Promise<RenderedPage> {
  return invoke<RenderedPage>("pdf_render_page", { pageIndex, dpi });
}

export async function pdfPrefetch(pageIndex: number, dpi: number): Promise<void> {
  return invoke<void>("pdf_prefetch", { pageIndex, dpi });
}

export async function pdfClose(): Promise<void> {
  return invoke<void>("pdf_close");
}

// External editor

export async function openInExternalEditor(
  relativePath: string,
  line: number,
  col: number,
): Promise<void> {
  return invoke<void>("open_in_external_editor", { relativePath, line, col });
}

// Export

export interface ExportSummary {
  exported_count: number;
  destination: string;
}

export interface ExportProgress {
  current: number;
  total: number;
}

export async function exportData(destination: string): Promise<ExportSummary> {
  return invoke<ExportSummary>("export_data", { destination });
}

export async function exportSubgraph(
  nodeId: string,
  depth: number,
  destination: string,
): Promise<ExportSummary> {
  return invoke<ExportSummary>("export_subgraph", { nodeId, depth, destination });
}

// License

export interface LicenseStatusResponse {
  state: "trial" | "expiring_soon" | "expired" | "licensed";
  days_remaining?: number;
  licensed_to?: string;
}

export async function getLicenseStatus(): Promise<LicenseStatusResponse> {
  return invoke<LicenseStatusResponse>("get_license_status");
}

export async function activateLicense(key: string): Promise<LicenseStatusResponse> {
  return invoke<LicenseStatusResponse>("activate_license", { key });
}

export interface OnlineValidationResult {
  action: "valid" | "revoked" | "skipped";
  reason?: string;
}

export async function checkOnlineValidation(): Promise<OnlineValidationResult> {
  return invoke<OnlineValidationResult>("check_online_validation");
}

export async function syncLicenseMenu(licenseState: string): Promise<void> {
  return invoke<void>("sync_license_menu", { licenseState });
}

// Annotation DSL

export type AnnotationType =
  | "note"
  | "question"
  | "todo"
  | "crossref"
  | "apparatus"
  | "translation"
  | "llm"
  | "bare";

export type Certainty = "tentative" | "firm" | "neutral";

export type AnnotationForm = "compact" | "block";

export type Scope =
  | { kind: "words"; value: number }
  | { kind: "paragraph"; value: number }
  | { kind: "page"; value: number }
  | { kind: "sentence"; value: number }
  | { kind: "anchor"; value: string }
  | { kind: "document"; value: 0 }
  | { kind: "section"; value: 0 }
  | { kind: "asymmetric"; value: { unit: ScopeKind; before: number; after: number } };

export type ScopeKind = "word" | "sentence" | "paragraph" | "page";

export type ResolutionMode = "backward" | "bidirectional";

export interface Annotation {
  form: AnnotationForm;
  annotation_type: AnnotationType;
  certainty: Certainty;
  scope: Scope;
  body: string | null;
  date: string | null;
  is_structured: boolean;
  char_start: number;
  char_end: number;
  original: string;
}

export interface ScopeRange {
  start: number;
  end: number;
}

export async function parseAnnotations(content: string): Promise<Annotation[]> {
  return invoke<Annotation[]>("parse_annotations", { content });
}

export async function resolveAnnotationScope(
  content: string,
  charStart: number,
  scope: Scope,
  lang: string,
): Promise<ScopeRange | null> {
  return invoke<ScopeRange | null>("resolve_annotation_scope", {
    content,
    charStart,
    scope,
    lang,
  });
}

export async function resolveAnnotationScopeWithMode(
  content: string,
  charStart: number,
  scope: Scope,
  lang: string,
  mode: ResolutionMode,
): Promise<ScopeRange | null> {
  return invoke<ScopeRange | null>("resolve_annotation_scope_with_mode", {
    content,
    charStart,
    scope,
    lang,
    mode,
  });
}

export interface AnnotationSearchResult {
  annotation_id: number;
  node_id: string;
  node_title: string;
  annotation_type: AnnotationType;
  certainty: Certainty;
  body: string | null;
  date: string | null;
  source_line: number;
  char_start: number;
  char_end: number;
}

export async function searchAnnotations(
  query: string,
  annotationType?: AnnotationType,
  limit?: number,
): Promise<AnnotationSearchResult[]> {
  return invoke<AnnotationSearchResult[]>("search_annotations", {
    query,
    annotationType: annotationType ?? null,
    limit: limit ?? null,
  });
}

export async function listAnnotations(
  nodeId?: string,
  annotationType?: AnnotationType,
  limit?: number,
): Promise<AnnotationSearchResult[]> {
  return invoke<AnnotationSearchResult[]>("list_annotations", {
    nodeId: nodeId ?? null,
    annotationType: annotationType ?? null,
    limit: limit ?? null,
  });
}
