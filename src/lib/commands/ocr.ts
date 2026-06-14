import { registerOnce } from "../commandRegistry";
import { useStatusMessageStore } from "../../stores/statusMessage";

export function initOcrCommands(): void {
  registerOnce("ocr", [
    {
      id: "ocr.toMarkdown",
      label: "OCR to Markdown",
      keywords: ["ocr", "pdf", "markdown", "convert", "scan"],
      icon: "📄",
      action: () => {
        useStatusMessageStore.getState().show(
          "Select an entry with a PDF in the Reference Library to use OCR",
        );
      },
    },
  ]);
}
