import { registerOnce } from "../commandRegistry";
import { useWorkspaceStore } from "../../stores/workspace";
import { usePreferencesStore } from "../../stores/preferences";
import { setPreference, rebuildGraphIndex } from "../ipc";
import { useStatusMessageStore } from "../../stores/statusMessage";

function hasWorkspace(): boolean {
  return useWorkspaceStore.getState().workspacePath !== null;
}

function hasPage(): boolean {
  return hasWorkspace() && useWorkspaceStore.getState().currentPagePath !== null;
}

const DARK_MODE_CYCLE: Array<"auto" | "dark" | "light"> = ["auto", "dark", "light"];

export function initCoreCommands(): void {
  registerOnce("core", [
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
      id: "core.settings.open",
      label: "Open Settings",
      keywords: ["settings", "preferences", "config"],
      icon: "⚙️",
      when: hasWorkspace,
      action: () => {
        window.dispatchEvent(new CustomEvent("lit:open-settings"));
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
      id: "core.graph.rebuildIndex",
      label: "Rebuild Graph Index",
      keywords: ["graph", "index", "rebuild", "reindex", "citation"],
      icon: "🔄",
      when: hasWorkspace,
      action: () => {
        useWorkspaceStore.setState({ graphReady: false });
        rebuildGraphIndex()
          .then((msg) => {
            useWorkspaceStore.setState({ graphReady: true });
            useStatusMessageStore.getState().show(msg);
            useWorkspaceStore.getState().refreshPages();
          })
          .catch((err) => {
            useWorkspaceStore.setState({ graphReady: true });
            useStatusMessageStore.getState().show(String(err), "error");
          });
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
  ]);
}
