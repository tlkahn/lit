import { registerOnce } from "../commandRegistry";

export function initOcrCommands(): void {
  registerOnce("ocr", [
    {
      id: "ocr.toMarkdown",
      label: "OCR to Markdown",
      keywords: ["ocr", "pdf", "markdown", "convert", "scan"],
      icon: "📄",
      action: () => {},
    },
  ]);
}
