import { registerOnce } from "../commandRegistry";
import { useWorkspaceStore } from "../../stores/workspace";

function hasPage(): boolean {
  const state = useWorkspaceStore.getState();
  return state.workspacePath !== null && state.currentPagePath !== null;
}

export function initCardboxAnkiExportCommands(): void {
  registerOnce("cardbox-anki-export", [
    {
      id: "cardbox.exportAnki",
      label: "Export Cardbox to Anki",
      keywords: ["cardbox", "export", "anki", "apkg", "flashcards", "deck"],
      icon: "\u{1F0CF}",
      when: hasPage,
      action: () => {
        const page = useWorkspaceStore.getState().currentPagePath;
        if (page) {
          void import("../cardboxAnkiExportFlow").then((m) => m.exportCardboxToAnki(page));
        }
      },
    },
  ]);
}
