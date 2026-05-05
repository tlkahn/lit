import { registerCommands } from "../commandRegistry";
import { useWorkspaceStore } from "../../stores/workspace";
import { usePreferencesStore } from "../../stores/preferences";
import { useFocusModeStore } from "../../stores/focusMode";
import { setPreference, getPreferencesPath } from "../ipc";

function hasWorkspace(): boolean {
  return useWorkspaceStore.getState().workspacePath !== null;
}

function hasPage(): boolean {
  return hasWorkspace() && useWorkspaceStore.getState().currentPagePath !== null;
}

const DARK_MODE_CYCLE: Array<"auto" | "dark" | "light"> = ["auto", "dark", "light"];

let initialized = false;

export function initCoreCommands(): void {
  if (initialized) return;
  initialized = true;
  registerCommands([
    {
      id: "core.theme.toggle",
      label: "Toggle Dark Mode",
      keywords: ["theme", "light", "dark"],
      icon: "🌓",
      action: () => {
        const current = usePreferencesStore.getState().darkMode;
        const idx = DARK_MODE_CYCLE.indexOf(current);
        const next = DARK_MODE_CYCLE[(idx + 1) % DARK_MODE_CYCLE.length];
        setPreference("workbench.darkMode", next).catch(console.error);
      },
    },
    {
      id: "core.focus.toggle",
      label: "Toggle Focus Mode",
      keywords: ["focus", "zen", "distraction"],
      icon: "🧘",
      action: () => {
        useFocusModeStore.getState().toggleFocusMode();
      },
    },
    {
      id: "core.settings.open",
      label: "Open Preferences File",
      keywords: ["settings", "preferences", "config"],
      icon: "⚙️",
      when: hasWorkspace,
      action: () => {
        getPreferencesPath()
          .then((path) => {
            useWorkspaceStore.getState().selectPageAtLine(path, 1, undefined, true);
          })
          .catch(console.error);
      },
    },
    {
      id: "core.workspace.reload",
      label: "Reload Workspace",
      keywords: ["refresh", "reload"],
      icon: "🔄",
      when: hasWorkspace,
      action: () => {
        useWorkspaceStore.getState().refreshPages();
      },
    },
    {
      id: "core.page.new",
      label: "New Page",
      keywords: ["create", "new", "page"],
      icon: "📄",
      when: hasWorkspace,
      action: () => {
        window.dispatchEvent(new CustomEvent("lit:new-page"));
      },
    },
    {
      id: "core.page.rename",
      label: "Rename Current Page",
      keywords: ["rename", "title"],
      icon: "✏️",
      when: hasPage,
      action: () => {
        window.dispatchEvent(new CustomEvent("lit:rename-page"));
      },
    },
    {
      id: "core.page.delete",
      label: "Delete Current Page",
      keywords: ["delete", "remove", "trash"],
      icon: "🗑️",
      when: hasPage,
      action: () => {
        window.dispatchEvent(new CustomEvent("lit:delete-page"));
      },
    },
    {
      id: "core.page.copyPath",
      label: "Copy Page Path",
      keywords: ["copy", "path", "clipboard"],
      icon: "📋",
      when: hasPage,
      action: () => {
        const path = useWorkspaceStore.getState().currentPagePath;
        if (path) navigator.clipboard.writeText(path).catch(console.error);
      },
    },
    {
      id: "core.annotation.insert",
      label: "Insert Annotation",
      keywords: ["annotation", "annotate", "note"],
      icon: "💬",
      when: hasPage,
      action: () => {
        window.dispatchEvent(new CustomEvent("lit:open-annotation-builder"));
      },
    },
  ]);
}

export function _resetCoreCommands(): void {
  initialized = false;
}
