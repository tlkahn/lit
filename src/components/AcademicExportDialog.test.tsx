import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { AcademicExportDialog } from "./AcademicExportDialog";
import { mockInvoke } from "../test/tauri-mock";
import { usePreferencesStore } from "../stores/preferences";
import { useWorkspaceStore } from "../stores/workspace";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  open: vi.fn(),
}));

let invokeCalls: { cmd: string; args: Record<string, unknown> }[];

beforeEach(() => {
  invokeCalls = [];
  mockInvoke((cmd, args) => {
    invokeCalls.push({ cmd, args: args ?? {} });
    if (cmd === "export_document") {
      return {
        output_path: "/tmp/output.tex",
        success: true,
        stderr: "",
        latex_errors: [],
      };
    }
    return undefined;
  });
  usePreferencesStore.setState({
    academicPandocPath: "",
    academicCrossrefPath: "",
    academicPdfEngine: "",
    academicDefaultCsl: "",
    academicDefaultTemplate: "",
    academicDefaultReferenceDoc: "",
  });
  useWorkspaceStore.setState({
    workspacePath: "/tmp/vault",
    currentPagePath: "hello.md",
  });
});

describe("AcademicExportDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <AcademicExportDialog open={false} onClose={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='academic-export-dialog']")).toBeNull();
  });

  it("renders dialog when open", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='academic-export-dialog']")).toBeTruthy();
  });

  it("shows format selector defaulting to initialFormat", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="pdf" />,
    );
    const select = container.querySelector("[data-testid='academic-export-format']") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("pdf");
  });

  it("defaults to latex when no initialFormat", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} />,
    );
    const select = container.querySelector("[data-testid='academic-export-format']") as HTMLSelectElement;
    expect(select.value).toBe("latex");
  });

  it("shows output path field", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} />,
    );
    const input = container.querySelector("[data-testid='academic-export-output-path']");
    expect(input).toBeTruthy();
  });

  it("shows Browse button", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} />,
    );
    const btn = container.querySelector("[data-testid='academic-export-browse-btn']");
    expect(btn).toBeTruthy();
  });

  it("shows CSL dropdown", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} />,
    );
    const select = container.querySelector("[data-testid='academic-export-csl']");
    expect(select).toBeTruthy();
    expect(select!.tagName).toBe("SELECT");
  });

  it("shows template field for latex format", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="latex" />,
    );
    const input = container.querySelector("[data-testid='academic-export-template']");
    expect(input).toBeTruthy();
  });

  it("shows template field for pdf format", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="pdf" />,
    );
    const input = container.querySelector("[data-testid='academic-export-template']");
    expect(input).toBeTruthy();
  });

  it("hides template field for docx format", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="docx" />,
    );
    const input = container.querySelector("[data-testid='academic-export-template']");
    expect(input).toBeNull();
  });

  it("hides template field for html format", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="html" />,
    );
    const input = container.querySelector("[data-testid='academic-export-template']");
    expect(input).toBeNull();
  });

  it("shows reference doc field for docx only", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="docx" />,
    );
    const input = container.querySelector("[data-testid='academic-export-reference-doc']");
    expect(input).toBeTruthy();
  });

  it("hides reference doc field for latex", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="latex" />,
    );
    const input = container.querySelector("[data-testid='academic-export-reference-doc']");
    expect(input).toBeNull();
  });

  it("shows PDF engine dropdown for pdf only", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="pdf" />,
    );
    const select = container.querySelector("[data-testid='academic-export-pdf-engine']");
    expect(select).toBeTruthy();
  });

  it("hides PDF engine dropdown for latex", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="latex" />,
    );
    const select = container.querySelector("[data-testid='academic-export-pdf-engine']");
    expect(select).toBeNull();
  });

  it("export button disabled when no output path", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} />,
    );
    const btn = container.querySelector("[data-testid='academic-export-btn']") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
  });

  it("Escape closes dialog", () => {
    const onClose = vi.fn();
    render(
      <AcademicExportDialog open={true} onClose={onClose} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancel button renders and calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(
      <AcademicExportDialog open={true} onClose={onClose} />,
    );
    const cancelBtn = container.querySelector("[data-testid='academic-export-cancel-btn']") as HTMLButtonElement;
    expect(cancelBtn).toBeTruthy();
    expect(cancelBtn.textContent).toBe("Cancel");
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("changes format when selecting different option", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="latex" />,
    );
    const formatSelect = container.querySelector("[data-testid='academic-export-format']") as HTMLSelectElement;
    fireEvent.change(formatSelect, { target: { value: "pdf" } });
    expect(formatSelect.value).toBe("pdf");
    // PDF engine should now be visible
    expect(container.querySelector("[data-testid='academic-export-pdf-engine']")).toBeTruthy();
  });

  it("shows success message after export", async () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="latex" />,
    );
    // Simulate having output path set by directly setting state via Browse action
    // We need to set the output path via internal state; use the browse button mock
    const { save } = await import("@tauri-apps/plugin-dialog");
    (save as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/tmp/output.tex");

    const browseBtn = container.querySelector("[data-testid='academic-export-browse-btn']")!;
    await act(async () => {
      fireEvent.click(browseBtn);
    });

    const exportBtn = container.querySelector("[data-testid='academic-export-btn']") as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(exportBtn);
    });

    const successMsg = container.querySelector("[data-testid='academic-export-success']");
    expect(successMsg).toBeTruthy();
  });

  it("shows error on failure", async () => {
    mockInvoke((cmd) => {
      if (cmd === "export_document") {
        return {
          output_path: "/tmp/output.tex",
          success: false,
          stderr: "pandoc: command not found",
          latex_errors: [{ message: "Missing package", line: 10, error_type: "error" }],
        };
      }
      return undefined;
    });

    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="latex" />,
    );

    const { save } = await import("@tauri-apps/plugin-dialog");
    (save as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/tmp/output.tex");

    const browseBtn = container.querySelector("[data-testid='academic-export-browse-btn']")!;
    await act(async () => {
      fireEvent.click(browseBtn);
    });

    const exportBtn = container.querySelector("[data-testid='academic-export-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(exportBtn);
    });

    const errorMsg = container.querySelector("[data-testid='academic-export-error']");
    expect(errorMsg).toBeTruthy();
    expect(errorMsg!.textContent).toContain("pandoc: command not found");
  });
});
