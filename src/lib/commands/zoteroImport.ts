import { registerOnce } from "../commandRegistry";
import { useStatusMessageStore } from "../../stores/statusMessage";
import { useWorkspaceStore } from "../../stores/workspace";

export function initZoteroImportCommands(): void {
  registerOnce("zoteroImport", [
    {
      id: "zotero.importAnnotations",
      label: "Import Zotero Annotations",
      keywords: ["zotero", "annotations", "import", "highlight"],
      when: () => useWorkspaceStore.getState().workspacePath != null,
      action: () => {
        useStatusMessageStore.getState().show(
          "Use the library panel to import Zotero annotations for a specific entry",
        );
      },
    },
  ]);
}
