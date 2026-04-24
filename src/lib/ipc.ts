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

export async function parseRawYaml(rawYaml: string): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("parse_raw_yaml", { rawYaml });
}

export async function getInitialWorkspace(): Promise<string | null> {
  return invoke<string | null>("get_initial_workspace");
}

export async function openWorkspaceWindow(path?: string): Promise<string> {
  return invoke<string>("open_workspace_window", { path: path ?? null });
}

export async function getPendingWorkspace(): Promise<string | null> {
  return invoke<string | null>("get_pending_workspace");
}

export async function getInitialFile(): Promise<string | null> {
  return invoke<string | null>("get_initial_file");
}

export async function getPendingFile(): Promise<string | null> {
  return invoke<string | null>("get_pending_file");
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

export interface KeyBinding {
  key: string;
  command: string;
  when?: string;
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

// External editor

export async function openInExternalEditor(
  relativePath: string,
  line: number,
  col: number,
): Promise<void> {
  return invoke<void>("open_in_external_editor", { relativePath, line, col });
}


