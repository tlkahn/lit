import { registerOnce } from "../commandRegistry";
import { useStatusMessageStore } from "../../stores/statusMessage";
import { useWorkspaceStore } from "../../stores/workspace";

export function initOcrCommands(): void {
  registerOnce("ocr", [
    {
      id: "ocr.toMarkdown",
      label: "OCR to Markdown",
      keywords: ["ocr", "pdf", "markdown", "convert", "scan"],
      icon: "📄",
      when: () => useWorkspaceStore.getState().workspacePath != null,
      action: () => {
        useStatusMessageStore.getState().show(
          "Select an entry with a downloaded PDF in the Reference Library, then use the OCR button",
        );
      },
    },
  ]);
}
