import { registerOnce } from "../commandRegistry";
import { useWorkspaceStore } from "../../stores/workspace";

function hasPage(): boolean {
  const state = useWorkspaceStore.getState();
  return state.workspacePath !== null && state.currentPagePath !== null;
}

export function initAcademicExportCommands(): void {
  registerOnce("academic-export", [
    {
      id: "academic.exportLatex",
      label: "Export to LaTeX",
      keywords: ["export", "latex", "tex", "pandoc", "academic"],
      icon: "\u{1F4DC}",
      when: hasPage,
      action: () => {
        window.dispatchEvent(new CustomEvent("lit:open-academic-export", { detail: { format: "latex" } }));
      },
    },
    {
      id: "academic.exportPdf",
      label: "Export to PDF",
      keywords: ["export", "pdf", "pandoc", "academic", "latex"],
      icon: "\u{1F4C4}",
      when: hasPage,
      action: () => {
        window.dispatchEvent(new CustomEvent("lit:open-academic-export", { detail: { format: "pdf" } }));
      },
    },
    {
      id: "academic.exportHtml",
      label: "Export to HTML",
      keywords: ["export", "html", "pandoc", "academic", "web"],
      icon: "\u{1F310}",
      when: hasPage,
      action: () => {
        window.dispatchEvent(new CustomEvent("lit:open-academic-export", { detail: { format: "html" } }));
      },
    },
    {
      id: "academic.exportDocx",
      label: "Export to DOCX",
      keywords: ["export", "docx", "word", "pandoc", "academic"],
      icon: "\u{1F4DD}",
      when: hasPage,
      action: () => {
        window.dispatchEvent(new CustomEvent("lit:open-academic-export", { detail: { format: "docx" } }));
      },
    },
  ]);
}
