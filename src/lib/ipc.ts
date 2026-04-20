import { invoke } from "@tauri-apps/api/core";

export interface AppInfo {
  name: string;
  version: string;
}

export async function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("get_app_info");
}
