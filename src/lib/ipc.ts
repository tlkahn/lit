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

export async function getInitialWorkspace(): Promise<string | null> {
  return invoke<string | null>("get_initial_workspace");
}

export async function openWorkspaceWindow(path?: string): Promise<string> {
  return invoke<string>("open_workspace_window", { path: path ?? null });
}

export async function getPendingWorkspace(): Promise<string | null> {
  return invoke<string | null>("get_pending_workspace");
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
