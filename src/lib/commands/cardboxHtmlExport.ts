import { registerOnce } from "../commandRegistry";
import { useWorkspaceStore } from "../../stores/workspace";

function hasPage(): boolean {
  const state = useWorkspaceStore.getState();
  return state.workspacePath !== null && state.currentPagePath !== null;
}

export function initCardboxHtmlExportCommands(): void {
  registerOnce("cardbox-html-export", [
    {
      id: "cardbox.exportHtml",
      label: "Export Cardbox to HTML",
      keywords: ["cardbox", "export", "html", "cards", "flashcards"],
      icon: "\u{1F0CF}",
      when: hasPage,
      action: () => {
        const page = useWorkspaceStore.getState().currentPagePath;
        if (page) {
          void import("../cardboxHtmlExportFlow").then((m) => m.exportCardboxToHtml(page));
        }
      },
    },
  ]);
}
