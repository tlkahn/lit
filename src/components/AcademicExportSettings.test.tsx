import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { AcademicExportSettings } from "./AcademicExportSettings";
import { mockInvoke } from "../test/tauri-mock";

let invokeCalls: { cmd: string; args: Record<string, unknown> }[];

beforeEach(() => {
  invokeCalls = [];
  mockInvoke((cmd, args) => {
    invokeCalls.push({ cmd, args: args ?? {} });
    if (cmd === "detect_pandoc") {
      return {
        pandoc_path: "/usr/local/bin/pandoc",
        pandoc_version: "3.1.9",
        crossref_path: "/usr/local/bin/pandoc-crossref",
        crossref_version: "0.3.17.0",
        pdf_engines: ["xelatex", "lualatex", "pdflatex"],
      };
    }
    return undefined;
  });
});

describe("AcademicExportSettings", () => {
  it("renders auto-detect button", () => {
    const { container } = render(<AcademicExportSettings />);
    const btn = container.querySelector("[data-testid='academic-detect-btn']");
    expect(btn).toBeTruthy();
    expect(btn!.tagName).toBe("BUTTON");
  });

  it("calls detectPandoc on click", async () => {
    const { container } = render(<AcademicExportSettings />);
    const btn = container.querySelector("[data-testid='academic-detect-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(invokeCalls).toContainEqual({ cmd: "detect_pandoc", args: {} });
  });

  it("shows pandoc version after successful detect", async () => {
    const { container } = render(<AcademicExportSettings />);
    const btn = container.querySelector("[data-testid='academic-detect-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    const status = container.querySelector("[data-testid='academic-pandoc-status']");
    expect(status).toBeTruthy();
    expect(status!.textContent).toContain("3.1.9");
  });

  it("shows error state on detect failure", async () => {
    mockInvoke((cmd) => {
      if (cmd === "detect_pandoc")
        throw new Error(
          "pandoc is required for detection but was not found on your system.\n\nTo install pandoc:\n  - macOS: brew install pandoc",
        );
      return undefined;
    });
    const { container } = render(<AcademicExportSettings />);
    const btn = container.querySelector("[data-testid='academic-detect-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    const status = container.querySelector("[data-testid='academic-pandoc-status']");
    expect(status).toBeTruthy();
    expect(status!.textContent).toContain("Not found");
  });

  it("shows configuration-error header for stale configured path", async () => {
    mockInvoke((cmd) => {
      if (cmd === "detect_pandoc")
        throw new Error(
          "The configured pandoc path does not exist or is not a file: /old/pandoc\n\nThis path is set in Settings.",
        );
      return undefined;
    });
    const { container } = render(<AcademicExportSettings />);
    const btn = container.querySelector("[data-testid='academic-detect-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    const status = container.querySelector("[data-testid='academic-pandoc-status']");
    expect(status).toBeTruthy();
    expect(status!.textContent).toContain("Configuration error");
    expect(status!.textContent).not.toContain("Not found");
    const detail = container.querySelector("[data-testid='academic-pandoc-error-detail']");
    expect(detail).toBeTruthy();
    expect(detail!.textContent).toContain("configured pandoc path");
  });

  it("shows crossref status after detect", async () => {
    const { container } = render(<AcademicExportSettings />);
    const btn = container.querySelector("[data-testid='academic-detect-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    const status = container.querySelector("[data-testid='academic-crossref-status']");
    expect(status).toBeTruthy();
    expect(status!.textContent).toContain("0.3.17.0");
  });

  it("shows crossref not found when null", async () => {
    mockInvoke((cmd) => {
      if (cmd === "detect_pandoc") {
        return {
          pandoc_path: "/usr/local/bin/pandoc",
          pandoc_version: "3.1.9",
          crossref_path: null,
          crossref_version: null,
          pdf_engines: [],
        };
      }
      return undefined;
    });
    const { container } = render(<AcademicExportSettings />);
    const btn = container.querySelector("[data-testid='academic-detect-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    const status = container.querySelector("[data-testid='academic-crossref-status']");
    expect(status).toBeTruthy();
    expect(status!.textContent).toContain("Not found");
  });

  it("shows pdf engines list after detect", async () => {
    const { container } = render(<AcademicExportSettings />);
    const btn = container.querySelector("[data-testid='academic-detect-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    const engines = container.querySelector("[data-testid='academic-pdf-engines']");
    expect(engines).toBeTruthy();
    expect(engines!.textContent).toContain("xelatex");
    expect(engines!.textContent).toContain("lualatex");
    expect(engines!.textContent).toContain("pdflatex");
  });

  it("shows actual error detail message on detect failure", async () => {
    mockInvoke((cmd) => {
      if (cmd === "detect_pandoc") throw new Error("pandoc is required for detection but was not found on your system.\n\nTo install pandoc:\n  - macOS: brew install pandoc");
      return undefined;
    });
    const { container } = render(<AcademicExportSettings />);
    const btn = container.querySelector("[data-testid='academic-detect-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    const detail = container.querySelector("[data-testid='academic-pandoc-error-detail']");
    expect(detail).toBeTruthy();
    expect(detail!.textContent).toContain("pandoc is required");
    expect(detail!.textContent).toContain("brew install pandoc");
    expect(detail!.className).toContain("whitespace-pre-line");
  });
});
