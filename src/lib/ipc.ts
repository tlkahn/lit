import { invoke } from "@tauri-apps/api/core";
import type { EdgeFilters } from "../stores/graphViewState";

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
  file_type: 'markdown' | 'pdf' | 'code';
  has_companion: boolean;
}

export interface PageContent {
  meta: PageMeta;
  body: string;
  raw_yaml: string;
}

export interface CodeFileContent {
  title: string;
  relative_path: string;
  body: string;
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

export async function readCodeFile(relativePath: string): Promise<CodeFileContent> {
  return invoke<CodeFileContent>("read_code_file", { relativePath });
}

export async function writeCodeFile(relativePath: string, body: string): Promise<void> {
  return invoke<void>("write_code_file", { relativePath, body });
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

// Trash commands

export async function trashPage(relativePath: string): Promise<void> {
  return invoke<void>("trash_page", { relativePath });
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

export const VIEW_MODES = ["editor", "mindmap", "graph", "cardbox"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export function isViewMode(value: unknown): value is ViewMode {
  return VIEW_MODES.includes(value as ViewMode);
}

export interface Preferences {
  "workbench.colorTheme": string | null;
  "workbench.darkMode": DarkModePref;
  "workbench.sideBar.location": string;
  "editor.folding.enabled": boolean;
  "editor.folding.showFoldingControls": string;
  "workbench.defaultViewMode": ViewMode;
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

// Secret store commands

export interface SecretStoreStatus {
  exists: boolean;
  unlocked: boolean;
}

export async function autoUnlockSecretStore(): Promise<boolean> {
  return invoke<boolean>("auto_unlock_secret_store");
}

export async function migrateSecretStore(oldPassphrase: string): Promise<void> {
  return invoke<void>("migrate_secret_store", { oldPassphrase });
}

export async function secretStoreStatus(): Promise<SecretStoreStatus> {
  return invoke<SecretStoreStatus>("secret_store_status");
}

// LLM commands

export interface LlmPromptStreamingArgs {
  model: string;
  text: string;
  system?: string;
  messages?: Array<{ role: string; content: string }>;
  options?: Record<string, unknown>;
  baseUrl?: string;
  provider?: string;
  contextWindow?: number;
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
      provider: args.provider ?? "",
      context_window: args.contextWindow ?? null,
    },
  });
}

export interface BuiltContext {
  system: string;
  messages: Array<{ role: string; content: string }>;
  truncation: { original_tokens: number; kept_tokens: number } | null;
}

export async function llmBuildContext(args: {
  nodeId: string;
  systemPrompt?: string;
  neighborsDepth: number;
  model: string;
  messages: Array<{ role: string; content: string }>;
  provider?: string;
  contextWindow?: number;
}): Promise<BuiltContext> {
  return invoke<BuiltContext>("llm_build_context", {
    args: {
      node_id: args.nodeId,
      system_prompt: args.systemPrompt ?? "",
      neighbors_depth: args.neighborsDepth,
      model: args.model,
      messages: args.messages,
      provider: args.provider ?? "",
      context_window: args.contextWindow ?? null,
    },
  });
}

export async function llmCancel(): Promise<void> {
  return invoke<void>("llm_cancel");
}

export async function testLlmConnection(
  model: string,
  baseUrl?: string,
  provider?: string,
): Promise<void> {
  return invoke<void>("llm_test_connection", {
    model,
    baseUrl: baseUrl ?? null,
    provider: provider ?? null,
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
  abstract_text?: string;
  doi?: string;
  journal?: string;
  url?: string;
  file?: string;
  volume?: string;
  number?: string;
  pages?: string;
  publisher?: string;
  issn?: string;
  isbn?: string;
  arxiv_id?: string;
  oclc?: string;
  work_type?: string;
  series?: string;
  lccn?: string;
  editors?: string[];
  tags?: string[];
}

// SaveOutcome — externally-tagged serde enum from Rust
export type SaveOutcome =
  | { Saved: { key: string } }
  | { DuplicateDoi: { doi: string; existing_key: string } }
  | { SavedNoDoi: { key: string } };

// SaveOutcome type guards
export function isSaved(o: SaveOutcome): o is { Saved: { key: string } } {
  return "Saved" in o;
}
export function isDuplicateDoi(
  o: SaveOutcome,
): o is { DuplicateDoi: { doi: string; existing_key: string } } {
  return "DuplicateDoi" in o;
}
export function isSavedNoDoi(o: SaveOutcome): o is { SavedNoDoi: { key: string } } {
  return "SavedNoDoi" in o;
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

export async function listBibEntries(workspacePath: string): Promise<BibEntry[]> {
  return invoke<BibEntry[]>("list_bib_entries", { workspacePath });
}

// Bib import commands

export async function lookupDoi(doi: string): Promise<BibEntry> {
  return invoke<BibEntry>("lookup_doi", { doi });
}

export async function saveBibEntry(
  entry: BibEntry,
  workspacePath: string,
): Promise<SaveOutcome[]> {
  return invoke<SaveOutcome[]>("save_bib_entry", { entry, workspacePath });
}

export async function parseCslJson(jsonPath: string): Promise<BibEntry[]> {
  return invoke<BibEntry[]>("parse_csl_json", { jsonPath });
}

export async function saveBibEntries(
  entries: BibEntry[],
  workspacePath: string,
): Promise<SaveOutcome[]> {
  return invoke<SaveOutcome[]>("save_bib_entries", { entries, workspacePath });
}

export async function materializeCitation(bibKey: string): Promise<PageMeta> {
  return invoke<PageMeta>("materialize_citation", { bibKey });
}

// Bib enrichment

export interface EnrichResult {
  entry: BibEntry;
  fields_added: string[];
  references_found: number;
  references_appended: number;
  shadow_nodes_created: number;
  references_linked: number;
  candidates: BibEntry[];
  providers_searched: string[];
  providers_failed: string[];
}

export async function enrichBibEntry(
  bibKey: string,
  workspacePath: string,
): Promise<EnrichResult> {
  return invoke<EnrichResult>("enrich_bib_entry", { bibKey, workspacePath });
}

export async function applyEnrichmentCandidate(
  bibKey: string,
  candidate: BibEntry,
  workspacePath: string,
): Promise<EnrichResult> {
  return invoke<EnrichResult>("apply_enrichment_candidate", {
    bibKey, candidate, workspacePath,
  });
}

// PDF download / link

export async function downloadEntryPdf(
  key: string,
  workspacePath: string,
): Promise<string> {
  return invoke<string>("download_entry_pdf", { key, workspacePath });
}

export async function linkEntryPdf(
  key: string,
  filePath: string,
  workspacePath: string,
): Promise<string> {
  return invoke<string>("link_entry_pdf", { key, filePath, workspacePath });
}

export interface UpdateDownloadProgress {
  downloaded: number;
  total: number | null;
}

export type OcrProgressPayload = { key: string; step: string; detail?: string };

export async function ocrPdfToMarkdown(
  key: string,
  workspacePath: string,
  options?: { lead?: number; trail?: number; overwrite?: boolean },
): Promise<string> {
  return invoke<string>("ocr_pdf_to_markdown", {
    key,
    workspacePath,
    lead: options?.lead ?? 0,
    trail: options?.trail ?? 0,
    overwrite: options?.overwrite ?? false,
  });
}

export async function checkOcrTargetExists(
  key: string,
  workspacePath: string,
): Promise<boolean> {
  return invoke<boolean>("check_ocr_target_exists", { key, workspacePath });
}

// PDF recognition

export type ConfirmReason = "no_text_layer" | "no_identifier" | "no_match" | "offline_error";

export type ResolutionSource =
  | "DoiContentNegotiation"
  | "CrossrefApi"
  | "ArxivApi"
  | "OpenLibraryApi"
  | "GoogleBooksApi"
  | "CrossrefTitleSearch";

export type ValidationStatus = "validated" | "skipped";

export type RecognizeResult =
  | {
      kind: "resolved";
      outcome: SaveOutcome;
      source: ResolutionSource;
      validation: ValidationStatus;
      file: string;
      entry: BibEntry;
    }
  | {
      kind: "needs_confirmation";
      reason: ConfirmReason;
      prefilled: BibEntry;
      file: string;
      message: string | null;
    };

export async function recognizePdf(
  pdfPath: string,
  workspacePath: string,
): Promise<RecognizeResult> {
  return invoke<RecognizeResult>("recognize_pdf", { pdfPath, workspacePath });
}

export async function importRecognizedEntry(
  entry: BibEntry,
  workspacePath: string,
): Promise<SaveOutcome[]> {
  return invoke<SaveOutcome[]>("import_recognized_entry", { entry, workspacePath });
}

export async function bibSearch(
  query: string,
  limit: number,
  workspacePath: string,
): Promise<BibEntry[]> {
  return invoke<BibEntry[]>("bib_search", { query, limit, workspacePath });
}

export async function bibGet(
  citeKey: string,
  workspacePath: string,
): Promise<BibEntry | null> {
  return invoke<BibEntry | null>("bib_get", { citeKey, workspacePath });
}

export async function bibUpdateFields(
  citeKey: string,
  fields: Record<string, string>,
  workspacePath: string,
): Promise<boolean> {
  return invoke<boolean>("bib_update_fields", { citeKey, fields, workspacePath });
}

export async function getReferences(
  bibKey: string,
  workspacePath: string,
): Promise<BibEntry[]> {
  return invoke<BibEntry[]>("get_references", { bibKey, workspacePath });
}

export async function bibDelete(
  citeKey: string,
  workspacePath: string,
): Promise<boolean> {
  return invoke<boolean>("bib_delete", { citeKey, workspacePath });
}

export interface ProviderInfo {
  id: string;
  label: string;
  description: string;
  category: string;
  needs_api_key: boolean;
}

export async function listSearchProviders(): Promise<ProviderInfo[]> {
  return invoke<ProviderInfo[]>("list_search_providers");
}

export interface PaperSearchResult {
  entries: BibEntry[];
  pdf_urls: Record<string, string>;
  total_results: number;
  providers_searched: string[];
  providers_failed: string[];
}

export async function searchPapers(
  query: string,
  limit?: number,
  offset?: number,
  searchType?: string,
): Promise<PaperSearchResult> {
  return invoke<PaperSearchResult>("search_papers", {
    query,
    limit: limit ?? null,
    offset: offset ?? null,
    search_type: searchType ?? null,
  });
}

export interface EnsureCompanionBibResult {
  bib_path: string;
  bibliography_value: string | null;
}

export async function ensureInCompanionBib(
  citeKey: string,
  notePath: string,
  workspacePath: string,
  skipNoteRewrite: boolean = false,
): Promise<EnsureCompanionBibResult> {
  return invoke<EnsureCompanionBibResult>("ensure_in_companion_bib", {
    citeKey, notePath, workspacePath, skipNoteRewrite,
  });
}

// Graph

export const NODE_NOT_FOUND_PREFIX = "node not found:";

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

export type Materialization = "stub" | "shadow" | "partial" | "materialized";

export interface GraphNode {
  id: string;
  title: string;
  is_stub: boolean;
  materialization: Materialization;
}

export type EdgeKind = "wikilink" | "mdlink" | "citation" | "cardbox";

export interface SubgraphResult {
  nodes: GraphNode[];
  edges: [string, string, EdgeKind][];
  pagerank?: Record<string, number>;
  positions?: Record<string, { x: number; y: number }>;
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

export async function getCitingPages(bibKey: string): Promise<BacklinkEntry[]> {
  return invoke<BacklinkEntry[]>("get_citing_pages", { bibKey });
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
  edgeFilters?: EdgeFilters,
): Promise<SubgraphResult> {
  return invoke<SubgraphResult>("get_graph_subgraph", {
    seeds,
    depth,
    directed: directed ?? null,
    includeCitations: edgeFilters?.citations ?? null,
    includeCardbox: edgeFilters?.cardbox ?? null,
  });
}

export async function getFullSubgraph(edgeFilters?: EdgeFilters): Promise<SubgraphResult> {
  return invoke<SubgraphResult>("get_graph_subgraph", {
    seeds: [],
    depth: 0,
    directed: null,
    includeCitations: edgeFilters?.citations ?? null,
    includeCardbox: edgeFilters?.cardbox ?? null,
  });
}

export interface BibKeyState {
  materialization: string;
  page_id: string | null;
}

export async function getBibKeyStates(): Promise<Record<string, BibKeyState>> {
  return invoke<Record<string, BibKeyState>>("get_bib_key_states");
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

// Link rewriting

export interface LinkRedirect {
  oldTarget: string;
  newTarget: string;
}

export interface FileRewriteResult {
  relative_path: string;
  links_changed: number;
}

export interface RewriteSummary {
  files_scanned: number;
  files_modified: FileRewriteResult[];
  total_links_changed: number;
}

export async function rewriteLinks(redirects: LinkRedirect[]): Promise<RewriteSummary> {
  return invoke<RewriteSummary>("rewrite_links", {
    redirects: redirects.map((r) => ({
      old_target: r.oldTarget,
      new_target: r.newTarget,
    })),
  });
}

export async function rewriteVaultLinks(redirects: LinkRedirect[]): Promise<RewriteSummary> {
  return invoke<RewriteSummary>("rewrite_vault_links", {
    redirects: redirects.map((r) => ({
      old_target: r.oldTarget,
      new_target: r.newTarget,
    })),
  });
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

export async function getGraphPositions(): Promise<Record<string, { x: number; y: number }>> {
  return invoke<Record<string, { x: number; y: number }>>("get_graph_positions");
}

export async function ensureGraphReady(path: string): Promise<void> {
  return invoke<void>("ensure_graph_ready", { path });
}

/**
 * Extend the Tauri asset protocol scope to include a single file.
 *
 * Called by PdfViewer before loading a PDF via `convertFileSrc` so that
 * files outside the workspace root (e.g. companions found via absolute
 * search paths) are served by the asset protocol. Idempotent.
 */
export async function allowAssetScope(path: string): Promise<void> {
  return invoke<void>("allow_asset_scope", { path });
}

/**
 * Given a workspace-relative markdown or PDF path, return the relative path of
 * its sibling with the swapped extension (md<->pdf) if it exists, else null.
 */
export async function findCompanionFile(relativePath: string): Promise<string | null> {
  return invoke<string | null>("find_companion_file", { relativePath });
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

export interface LkgExportSummary {
  exported_count: number;
  destination: string;
  graph_hash: string;
}

export async function exportLkg(
  destination: string,
  title?: string,
  description?: string,
): Promise<LkgExportSummary> {
  return invoke<LkgExportSummary>("export_lkg", {
    destination,
    title: title ?? null,
    description: description ?? null,
  });
}

export interface LkgImportSummary {
  node_count: number;
  edge_count: number;
  annotation_count: number;
  file_count: number;
}

export async function importLkg(
  source: string,
  destination: string,
): Promise<LkgImportSummary> {
  return invoke<LkgImportSummary>("import_lkg", { source, destination });
}

// License

export interface LicenseStatusResponse {
  state: "unlicensed" | "licensed" | "license_expired" | "revoked";
  licensed_to?: string;
  source?: "direct";
  expires_at?: number;
  expiry_date?: string;
  reason?: string;
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

// Oplog (undo)

export interface OperationSummary {
  id: number;
  op_type: string;
  description: string;
  created_at: number;
}

export async function undoLastOperation(): Promise<string> {
  return invoke<string>("undo_last_operation");
}

export async function listUndoHistory(limit?: number): Promise<OperationSummary[]> {
  return invoke<OperationSummary[]>("list_undo_history", { limit: limit ?? null });
}

export async function canUndo(): Promise<boolean> {
  return invoke<boolean>("can_undo");
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
  | "thread"
  | "mark"
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
  uuid?: string | null;
  mark?: string | null;
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

/** One mark's scope-resolution request for the batched `resolveMarkScopes` IPC. */
export interface MarkScopeRequest {
  charStart: number;
  scope: Scope;
}

/**
 * Batched scope resolution: resolves every mark in a single IPC call. Results are
 * index-aligned with `marks` (`null` for marks whose scope did not resolve). The
 * per-mark `charStart` is emitted as snake_case `char_start` because Tauri's arg
 * casing only converts top-level command keys, not keys inside array payloads.
 */
export async function resolveMarkScopes(
  content: string,
  marks: MarkScopeRequest[],
  lang: string,
): Promise<Array<ScopeRange | null>> {
  return invoke<Array<ScopeRange | null>>("resolve_mark_scopes", {
    content,
    marks: marks.map((m) => ({ char_start: m.charStart, scope: m.scope })),
    lang,
  });
}

/// A single philological mark definition: how the mark is labelled and styled.
export interface MarkDef {
  label: string;
  icon?: string | null;
  before?: string | null;
  after?: string | null;
  style?: Record<string, string> | null;
}

/// A map of mark code -> definition (the Rust side is a transparent HashMap).
export type MarkConfig = Record<string, MarkDef>;

export async function getMarkConfig(): Promise<MarkConfig> {
  return invoke<MarkConfig>("get_mark_config");
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
  uuid: string;
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

// Cardbox (annotation-centered view)

/** Valid color-tag values — must match VALID_COLORS in src-tauri/src/commands/cardbox.rs */
export const CARDBOX_COLORS = ["blue", "orange", "green", "purple", "pink", "cyan"] as const;
export type CardboxColor = (typeof CARDBOX_COLORS)[number];

export interface CardboxAnnotation {
  uuid: string;
  annotation_type: string;
  certainty: string;
  body: string | null;
  date: string | null;
  source_page_id: string;
  source_page_title: string;
  source_line: number;
  char_start: number;
  char_end: number;
  scope_kind: string;
  scope_value: string;
  original: string | null;
}

export async function listAllAnnotations(): Promise<CardboxAnnotation[]> {
  return invoke<CardboxAnnotation[]>("list_all_annotations", {});
}

export interface GroupInfo {
  name: string;
  order: string[];
  collapsed: boolean;
}

export interface CardNote {
  body: string;
  updated_at?: string;
}

export interface CardboxLayout {
  version: number;
  order: string[];
  links: [string, string][];
  groups: Record<string, GroupInfo>;
  pinned: string[];
  notes: Record<string, CardNote>;
  colors: Record<string, string>;
}

export async function readCardboxLayout(): Promise<CardboxLayout> {
  return invoke<CardboxLayout>("read_cardbox_layout", {});
}

export async function writeCardboxLayout(layout: CardboxLayout): Promise<void> {
  return invoke<void>("write_cardbox_layout", { layout });
}

export async function addCardboxLink(a: string, b: string): Promise<void> {
  return invoke<void>("add_cardbox_link", { a, b });
}

export async function removeCardboxLink(a: string, b: string): Promise<void> {
  return invoke<void>("remove_cardbox_link", { a, b });
}

export async function createCardboxGroup(
  groupId: string,
  name: string,
  cardUuids: string[],
  afterEntry?: string,
): Promise<void> {
  return invoke<void>("create_cardbox_group", {
    groupId,
    name,
    cardUuids,
    afterEntry: afterEntry ?? null,
  });
}

export async function renameCardboxGroup(groupId: string, name: string): Promise<void> {
  return invoke<void>("rename_cardbox_group", { groupId, name });
}

export async function dissolveCardboxGroup(groupId: string): Promise<void> {
  return invoke<void>("dissolve_cardbox_group", { groupId });
}

export async function moveCardToGroup(
  cardUuid: string,
  targetGroupId: string,
  index?: number,
): Promise<void> {
  return invoke<void>("move_card_to_group", {
    cardUuid,
    targetGroupId,
    index: index ?? null,
  });
}

export async function removeCardFromGroup(
  cardUuid: string,
  groupId: string,
  topLevelIndex?: number,
): Promise<void> {
  return invoke<void>("remove_card_from_group", {
    cardUuid,
    groupId,
    topLevelIndex: topLevelIndex ?? null,
  });
}

export async function toggleGroupCollapsed(groupId: string, collapsed: boolean): Promise<void> {
  return invoke<void>("toggle_group_collapsed", { groupId, collapsed });
}

export async function pinCardboxCard(uuid: string): Promise<void> {
  return invoke<void>("pin_cardbox_card", { uuid });
}

export async function unpinCardboxCard(uuid: string): Promise<void> {
  return invoke<void>("unpin_cardbox_card", { uuid });
}

export async function setCardNote(uuid: string, body: string): Promise<void> {
  return invoke<void>("set_card_note", { uuid, body });
}

export async function clearCardNote(uuid: string): Promise<void> {
  return invoke<void>("clear_card_note", { uuid });
}

export async function exportCardNote(uuid: string): Promise<string> {
  return invoke<string>("export_card_note", { uuid });
}

export async function setCardColor(uuid: string, color: string): Promise<void> {
  return invoke<void>("set_card_color", { uuid, color });
}

export async function clearCardColor(uuid: string): Promise<void> {
  return invoke<void>("clear_card_color", { uuid });
}

export interface ColorEntry {
  uuid: string;
  color: string;
}

export async function batchSetCardColor(entries: ColorEntry[]): Promise<void> {
  return invoke<void>("batch_set_card_color", { entries });
}

export async function batchClearCardColor(uuids: string[]): Promise<void> {
  return invoke<void>("batch_clear_card_color", { uuids });
}

export async function batchPinCards(uuids: string[]): Promise<void> {
  return invoke<void>("batch_pin_cards", { uuids });
}

export async function batchUnpinCards(uuids: string[]): Promise<void> {
  return invoke<void>("batch_unpin_cards", { uuids });
}

// Merge/Split preview commands

export interface MergeInput {
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

export interface MergePlan {
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
  source_titles: string[];
}

export async function previewMerge(docs: MergeInput[]): Promise<MergePlan> {
  return invoke<MergePlan>("preview_merge", { docs });
}

export interface SplitChunk {
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

export interface SplitPlan {
  preamble: SplitChunk | null;
  sections: SplitChunk[];
}

export async function previewSplit(
  content: string,
  title: string,
  frontmatter: Record<string, unknown>,
): Promise<SplitPlan> {
  return invoke<SplitPlan>("preview_split", { content, title, frontmatter });
}

export async function executeSplit(relativePath: string): Promise<string[]> {
  return invoke<string[]>("execute_split", { relativePath });
}

export async function suggestMergeTitle(
  sourceTitles: string[],
  mergedBody: string,
): Promise<string | null> {
  try {
    return await invoke<string>("suggest_merge_title", { sourceTitles, mergedBody });
  } catch {
    return null;
  }
}

export async function cancelTitleSuggestion(): Promise<void> {
  return invoke<void>("cancel_title_suggestion");
}

export async function mergeDocuments(
  paths: string[],
  title: string,
  ordering: number[],
  outputDir?: string,
): Promise<string> {
  return invoke<string>("merge_documents", {
    paths,
    title,
    ordering,
    outputDir: outputDir ?? null,
  });
}

export async function annotationFindUuid(
  nodeId: string,
  annotationType: string,
  body: string | null,
  charStartHint: number,
): Promise<string | null> {
  return invoke<string | null>("annotation_find_uuid", {
    nodeId,
    annotationType,
    body,
    charStartHint,
  });
}

export async function migrateAnnotations(content: string): Promise<string> {
  return invoke<string>("migrate_annotations", { content });
}

// Academic export

export interface PandocInfo {
  pandoc_path: string;
  pandoc_version: string;
  crossref_path: string | null;
  crossref_version: string | null;
  pdf_engines: string[];
}

export interface ExportRequest {
  relativePath: string;
  outputPath: string;
  format: string;
  csl?: string;
  template?: string;
  referenceDoc?: string;
  pdfEngine?: string;
}

export interface LatexError {
  message: string;
  line: number | null;
  error_type: string;
}

export interface ExportDocumentResult {
  output_path: string;
  success: boolean;
  stderr: string;
  latex_errors: LatexError[];
}

export async function detectPandoc(): Promise<PandocInfo> {
  return invoke<PandocInfo>("detect_pandoc");
}

export async function exportDocument(request: ExportRequest): Promise<ExportDocumentResult> {
  return invoke<ExportDocumentResult>("export_document", {
    request: {
      relative_path: request.relativePath,
      output_path: request.outputPath,
      format: request.format,
      csl: request.csl,
      template: request.template,
      reference_doc: request.referenceDoc,
      pdf_engine: request.pdfEngine,
    },
  });
}
