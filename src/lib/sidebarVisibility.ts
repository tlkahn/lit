import { usePreferencesStore } from "../stores/preferences";
import { setPreference } from "./ipc";

/**
 * Ensure the sidebar is visible by synchronously updating the Zustand store
 * and firing an async IPC call to persist the preference to disk.
 *
 * Extracted from Sidebar.tsx and ReferenceLibrary.tsx so the "show sidebar"
 * contract lives in one place.
 */
export function ensureSidebarVisible(): void {
  usePreferencesStore.setState({ sidebarVisible: true });
  setPreference("workbench.sideBar.visible", true).catch(() => {});
}
