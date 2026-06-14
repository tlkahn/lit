import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, mockListen, resetListenMock, emitMockEvent } from "../test/tauri-mock";
import { OcrDialog } from "./OcrDialog";
import type { BibEntry } from "../lib/ipc";

const entry: BibEntry = {
  key: "smith2020",
  authors: ["Smith, John"],
  title: "Deep Learning Survey",
  year: "2020",
  entry_type: "article",
  line_number: 1,
  bib_file: "/workspace/refs.bib",
  file: "assets/pdf/smith2020.pdf",
};

let onClose: ReturnType<typeof vi.fn>;
let onComplete: ReturnType<typeof vi.fn>;
let invokedCommands: { cmd: string; args: unknown }[];

function defaultProps() {
  return { entry, workspacePath: "/workspace", onClose, onComplete };
}

beforeEach(() => {
  onClose = vi.fn();
  onComplete = vi.fn();
  invokedCommands = [];
  resetListenMock();
  mockListen();
  mockInvoke((cmd, args) => {
    invokedCommands.push({ cmd, args });
    if (cmd === "check_ocr_target_exists") return false;
    if (cmd === "ocr_pdf_to_markdown") return "ocr/smith2020.md";
    throw new Error(`Unknown command: ${cmd}`);
  });
});

describe("OcrDialog", () => {
  it("renders with entry title and key", () => {
    render(<OcrDialog {...defaultProps()} />);
    expect(screen.getByTestId("ocr-entry-info")).toHaveTextContent("Deep Learning Survey");
    expect(screen.getByTestId("ocr-entry-info")).toHaveTextContent("@smith2020");
    expect(screen.getByText("OCR to Markdown")).toBeInTheDocument();
  });

  it("lead/trail inputs default to 0", () => {
    render(<OcrDialog {...defaultProps()} />);
    expect(screen.getByTestId("ocr-lead-skip")).toHaveValue(0);
    expect(screen.getByTestId("ocr-trail-skip")).toHaveValue(0);
  });

  it("Start OCR button is present and enabled", () => {
    render(<OcrDialog {...defaultProps()} />);
    const btn = screen.getByTestId("ocr-start-btn");
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
    expect(btn.textContent).toBe("Start OCR");
  });

  it("shows progress step labels during OCR", async () => {
    let resolveOcr!: (value: string) => void;
    const pending = new Promise<string>((r) => { resolveOcr = r; });
    mockInvoke((cmd) => {
      if (cmd === "check_ocr_target_exists") return false;
      if (cmd === "ocr_pdf_to_markdown") return pending;
      throw new Error(`Unknown: ${cmd}`);
    });

    const user = userEvent.setup();
    render(<OcrDialog {...defaultProps()} />);
    await user.click(screen.getByTestId("ocr-start-btn"));

    act(() => {
      emitMockEvent("lit:ocr-progress", { key: "smith2020", step: "Extracting pages", detail: "page 3 of 10" });
    });

    await waitFor(() => {
      expect(screen.getByTestId("ocr-progress")).toHaveTextContent("Extracting pages");
      expect(screen.getByTestId("ocr-progress")).toHaveTextContent("page 3 of 10");
    });

    await act(async () => { resolveOcr("ocr/smith2020.md"); });
  });

  it("shows error inline on failure", async () => {
    mockInvoke((cmd) => {
      if (cmd === "check_ocr_target_exists") return false;
      if (cmd === "ocr_pdf_to_markdown") throw new Error("Tesseract not installed");
      throw new Error(`Unknown: ${cmd}`);
    });

    const user = userEvent.setup();
    render(<OcrDialog {...defaultProps()} />);
    await user.click(screen.getByTestId("ocr-start-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("ocr-error")).toHaveTextContent("Tesseract not installed");
    });
    expect(screen.getByTestId("ocr-start-btn")).not.toBeDisabled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("overwrite confirmation appears when target exists", async () => {
    mockInvoke((cmd) => {
      if (cmd === "check_ocr_target_exists") return true;
      if (cmd === "ocr_pdf_to_markdown") return "ocr/smith2020.md";
      throw new Error(`Unknown: ${cmd}`);
    });

    const user = userEvent.setup();
    render(<OcrDialog {...defaultProps()} />);
    await user.click(screen.getByTestId("ocr-start-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("ocr-overwrite-confirm")).toBeInTheDocument();
      expect(screen.getByTestId("ocr-overwrite-confirm")).toHaveTextContent("already exists");
    });
    expect(screen.getByTestId("ocr-start-btn")).toBeDisabled();
    expect(screen.getByTestId("ocr-overwrite-yes")).toBeInTheDocument();
    expect(screen.getByTestId("ocr-overwrite-no")).toBeInTheDocument();
  });

  it("overwrite confirmation cancel returns to dialog", async () => {
    mockInvoke((cmd) => {
      if (cmd === "check_ocr_target_exists") return true;
      if (cmd === "ocr_pdf_to_markdown") return "ocr/smith2020.md";
      throw new Error(`Unknown: ${cmd}`);
    });

    const user = userEvent.setup();
    render(<OcrDialog {...defaultProps()} />);
    await user.click(screen.getByTestId("ocr-start-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("ocr-overwrite-confirm")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("ocr-overwrite-no"));

    await waitFor(() => {
      expect(screen.queryByTestId("ocr-overwrite-confirm")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("ocr-start-btn")).not.toBeDisabled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("calls onComplete on success", async () => {
    const user = userEvent.setup();
    render(<OcrDialog {...defaultProps()} />);
    await user.click(screen.getByTestId("ocr-start-btn"));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith("ocr/smith2020.md");
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when X is clicked", async () => {
    const user = userEvent.setup();
    render(<OcrDialog {...defaultProps()} />);
    await user.click(screen.getByTestId("ocr-dialog-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Cancel button is clicked", async () => {
    const user = userEvent.setup();
    render(<OcrDialog {...defaultProps()} />);
    await user.click(screen.getByTestId("ocr-cancel-btn"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked", async () => {
    const user = userEvent.setup();
    render(<OcrDialog {...defaultProps()} />);
    await user.click(screen.getByTestId("ocr-dialog-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
