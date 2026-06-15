import { registerOnce } from "../commandRegistry";
import { useStatusMessageStore } from "../../stores/statusMessage";
import { useWorkspaceStore } from "../../stores/workspace";
import { importZoteroAll } from "../ipc";

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
    {
      id: "zotero.importAllAnnotations",
      label: "Import All Zotero Annotations",
      keywords: ["zotero", "annotations", "import", "batch", "all"],
      when: () => useWorkspaceStore.getState().workspacePath != null,
      action: async () => {
        const workspacePath = useWorkspaceStore.getState().workspacePath;
        if (!workspacePath) return;
        const status = useStatusMessageStore.getState();
        status.show("Importing Zotero annotations for all entries...");
        try {
          const result = await importZoteroAll(workspacePath);
          const parts: string[] = [];
          parts.push(`${result.entriesProcessed} entries processed`);
          parts.push(`${result.totalInserted} annotations inserted`);
          if (result.totalLlmPlaced > 0) {
            parts.push(`${result.totalLlmPlaced} placed by LLM`);
          }
          if (result.totalUnmatched > 0) {
            parts.push(`${result.totalUnmatched} unmatched`);
          }
          if (result.totalSkipped > 0) {
            parts.push(`${result.totalSkipped} duplicates skipped`);
          }
          if (result.errors.length > 0) {
            parts.push(`${result.errors.length} errors`);
          }
          status.show(parts.join(", "));
        } catch (e) {
          status.show(`Batch import failed: ${e}`);
        }
      },
    },
  ]);
}
