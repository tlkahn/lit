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
    if (cmd === "export_document" || cmd === "export_critical_edition") {
      return {
        output_path: "/tmp/output.tex",
        success: true,
        stderr: "",
      };
    }
    if (cmd === "set_preference") {
      return undefined;
    }
    return undefined;
  });
  usePreferencesStore.setState({
    academicPandocPath: "",
    academicCrossrefPath: "",
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
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="html" />,
    );
    const select = container.querySelector("[data-testid='academic-export-format']") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("html");
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
    fireEvent.change(formatSelect, { target: { value: "html" } });
    expect(formatSelect.value).toBe("html");
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

  it("preserves newlines in multi-line error text", async () => {
    mockInvoke((cmd) => {
      if (cmd === "export_document") {
        return {
          output_path: "/tmp/output.pdf",
          success: false,
          stderr: "pandoc is required for export\n\nTo install pandoc:\n  - macOS: brew install pandoc",
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

    const errorDiv = container.querySelector("[data-testid='academic-export-error']");
    expect(errorDiv).toBeTruthy();
    const stderrDiv = errorDiv!.querySelector(".whitespace-pre-line");
    expect(stderrDiv).toBeTruthy();
    expect(stderrDiv!.textContent).toContain("brew install pandoc");
  });

  // --- C2: format offers Critical Edition ---

  it("format select offers Critical Edition (LaTeX)", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} />,
    );
    const select = container.querySelector("[data-testid='academic-export-format']") as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(options).toContain("reledmac");
  });

  it("selecting reledmac shows routing table and line numbers", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="reledmac" />,
    );
    const routingTable = container.querySelector("[data-testid='reledmac-routing-table']");
    expect(routingTable).toBeTruthy();
    const checkbox = container.querySelector("[data-testid='reledmac-line-numbers']");
    expect(checkbox).toBeTruthy();
  });

  it("selecting reledmac hides template and reference-doc fields", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="reledmac" />,
    );
    expect(container.querySelector("[data-testid='academic-export-template']")).toBeNull();
    expect(container.querySelector("[data-testid='academic-export-reference-doc']")).toBeNull();
  });

  // --- C3: default routing UI ---

  it("routing table defaults to issue mapping", () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="reledmac" />,
    );
    const nRoute = container.querySelector("[data-testid='reledmac-route-n']") as HTMLSelectElement;
    expect(nRoute.value).toBe("right");
    const appRoute = container.querySelector("[data-testid='reledmac-route-app']") as HTMLSelectElement;
    expect(appRoute.value).toBe("afootnote");
    const cfRoute = container.querySelector("[data-testid='reledmac-route-cf']") as HTMLSelectElement;
    expect(cfRoute.value).toBe("bfootnote");
    const qRoute = container.querySelector("[data-testid='reledmac-route-q']") as HTMLSelectElement;
    expect(qRoute.value).toBe("suppress");
  });

  // --- C4: export invocation ---

  it("clicking Export with reledmac calls exportCriticalEdition", async () => {
    const { container } = render(
      <AcademicExportDialog open={true} onClose={vi.fn()} initialFormat="reledmac" />,
    );

    const { save } = await import("@tauri-apps/plugin-dialog");
    (save as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/tmp/critical.tex");

    const browseBtn = container.querySelector("[data-testid='academic-export-browse-btn']")!;
    await act(async () => {
      fireEvent.click(browseBtn);
    });

    const exportBtn = container.querySelector("[data-testid='academic-export-btn']") as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(exportBtn);
    });

    const ceCall = invokeCalls.find((c) => c.cmd === "export_critical_edition");
    expect(ceCall).toBeTruthy();
    const req = ceCall!.args.request as Record<string, unknown>;
    expect(req.relativePath).toBe("hello.md");
    expect(req.outputPath).toBe("/tmp/critical.tex");
    expect(req.lineNumbers).toBe(true);
    expect(req.routing).toEqual({
      n: "right",
      tr: "right",
      app: "afootnote",
      cf: "bfootnote",
      q: "suppress",
      todo: "suppress",
      llm: "suppress",
      th: "suppress",
      bare: "right",
      sn: "parent",
    });

    const successMsg = container.querySelector("[data-testid='academic-export-success']");
    expect(successMsg).toBeTruthy();
  });
});
