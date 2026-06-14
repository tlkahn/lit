import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, mockListen, resetListenMock, emitMockEvent } from "../test/tauri-mock";
import { OcrDialog } from "./OcrDialog";
import { useModalLockStore } from "../stores/modalLock";
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
  useModalLockStore.setState({ openCount: 0, locked: false, llmLocked: false });
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

  it("acquires modal lock while mounted", () => {
    const { unmount } = render(<OcrDialog {...defaultProps()} />);
    expect(useModalLockStore.getState().locked).toBe(true);
    expect(useModalLockStore.getState().openCount).toBe(1);

    unmount();
    expect(useModalLockStore.getState().locked).toBe(false);
    expect(useModalLockStore.getState().openCount).toBe(0);
  });

  // --- 4.1.1 Full flow: command sequence and argument forwarding ---

  it("full flow: invokes check then ocr in sequence with correct args", async () => {
    const user = userEvent.setup();
    render(<OcrDialog {...defaultProps()} />);
    await user.click(screen.getByTestId("ocr-start-btn"));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith("ocr/smith2020.md");
    });

    // Verify command sequence
    expect(invokedCommands.length).toBe(2);
    expect(invokedCommands[0]!.cmd).toBe("check_ocr_target_exists");
    expect(invokedCommands[1]!.cmd).toBe("ocr_pdf_to_markdown");

    // Verify argument shapes
    expect(invokedCommands[0]!.args).toEqual({
      key: "smith2020",
      workspacePath: "/workspace",
    });
    expect(invokedCommands[1]!.args).toEqual({
      key: "smith2020",
      workspacePath: "/workspace",
      lead: 0,
      trail: 0,
      overwrite: false,
    });
  });

  it("full flow: forwards custom lead/trail to backend", async () => {
    const user = userEvent.setup();
    render(<OcrDialog {...defaultProps()} />);

    const leadInput = screen.getByTestId("ocr-lead-skip");
    const trailInput = screen.getByTestId("ocr-trail-skip");

    await user.clear(leadInput);
    await user.type(leadInput, "2");
    await user.clear(trailInput);
    await user.type(trailInput, "3");

    await user.click(screen.getByTestId("ocr-start-btn"));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith("ocr/smith2020.md");
    });

    const ocrCmd = invokedCommands.find((c) => c.cmd === "ocr_pdf_to_markdown");
    expect(ocrCmd).toBeDefined();
    expect(ocrCmd!.args).toEqual(
      expect.objectContaining({ lead: 2, trail: 3 }),
    );
  });

  // --- 4.1.5 Overwrite flow ---

  it("overwrite flow: confirm calls ocr with overwrite=true and completes", async () => {
    mockInvoke((cmd) => {
      invokedCommands.push({ cmd, args: undefined });
      if (cmd === "check_ocr_target_exists") return true;
      if (cmd === "ocr_pdf_to_markdown") return "ocr/smith2020.md";
      throw new Error(`Unknown: ${cmd}`);
    });
    // Re-wire to capture args too
    invokedCommands = [];
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
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

    await user.click(screen.getByTestId("ocr-overwrite-yes"));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith("ocr/smith2020.md");
    });

    const ocrCmd = invokedCommands.find((c) => c.cmd === "ocr_pdf_to_markdown");
    expect(ocrCmd).toBeDefined();
    expect(ocrCmd!.args).toEqual(
      expect.objectContaining({ overwrite: true }),
    );
  });

  it("overwrite flow: skips second existence check", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
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

    await user.click(screen.getByTestId("ocr-overwrite-yes"));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith("ocr/smith2020.md");
    });

    // check_ocr_target_exists should have been called exactly once
    const checkCmds = invokedCommands.filter((c) => c.cmd === "check_ocr_target_exists");
    expect(checkCmds).toHaveLength(1);
  });

  it("overwrite flow: shows progress during overwrite", async () => {
    let resolveOcr!: (value: string) => void;
    const pending = new Promise<string>((r) => { resolveOcr = r; });
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "check_ocr_target_exists") return true;
      if (cmd === "ocr_pdf_to_markdown") return pending;
      throw new Error(`Unknown: ${cmd}`);
    });

    const user = userEvent.setup();
    render(<OcrDialog {...defaultProps()} />);
    await user.click(screen.getByTestId("ocr-start-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("ocr-overwrite-confirm")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("ocr-overwrite-yes"));

    act(() => {
      emitMockEvent("lit:ocr-progress", { key: "smith2020", step: "Running Mistral OCR", detail: "page 1 of 5" });
    });

    await waitFor(() => {
      expect(screen.getByTestId("ocr-progress")).toHaveTextContent("Running Mistral OCR");
      expect(screen.getByTestId("ocr-progress")).toHaveTextContent("page 1 of 5");
    });

    await act(async () => { resolveOcr("ocr/smith2020.md"); });
  });

  // --- 4.1.6 Error states ---

  it("error from check_ocr_target_exists is displayed", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "check_ocr_target_exists") throw new Error("Graph index not ready");
      if (cmd === "ocr_pdf_to_markdown") return "ocr/smith2020.md";
      throw new Error(`Unknown: ${cmd}`);
    });

    const user = userEvent.setup();
    render(<OcrDialog {...defaultProps()} />);
    await user.click(screen.getByTestId("ocr-start-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("ocr-error")).toHaveTextContent("Graph index not ready");
    });

    // ocr_pdf_to_markdown should NOT have been invoked
    const ocrCmds = invokedCommands.filter((c) => c.cmd === "ocr_pdf_to_markdown");
    expect(ocrCmds).toHaveLength(0);
  });

  it("Mistral API key error shows user-friendly message", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "check_ocr_target_exists") return false;
      if (cmd === "ocr_pdf_to_markdown")
        throw new Error("Mistral API key required — configure in Settings → LLM");
      throw new Error(`Unknown: ${cmd}`);
    });

    const user = userEvent.setup();
    render(<OcrDialog {...defaultProps()} />);
    await user.click(screen.getByTestId("ocr-start-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("ocr-error")).toHaveTextContent("Mistral API key required");
    });
  });

  it("error state allows retry", async () => {
    let callCount = 0;
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "check_ocr_target_exists") return false;
      if (cmd === "ocr_pdf_to_markdown") {
        callCount++;
        if (callCount === 1) throw new Error("Temporary failure");
        return "ocr/smith2020.md";
      }
      throw new Error(`Unknown: ${cmd}`);
    });

    const user = userEvent.setup();
    render(<OcrDialog {...defaultProps()} />);

    // First attempt: fails
    await user.click(screen.getByTestId("ocr-start-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("ocr-error")).toHaveTextContent("Temporary failure");
    });
    expect(screen.getByTestId("ocr-start-btn")).not.toBeDisabled();

    // Second attempt: succeeds
    await user.click(screen.getByTestId("ocr-start-btn"));
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith("ocr/smith2020.md");
    });
    // Error should be cleared after successful retry
    expect(screen.queryByTestId("ocr-error")).not.toBeInTheDocument();
  });

  // --- 4.2.2 Large PDFs: rapid progress events ---

  it("handles rapid progress events from large PDF without hanging", async () => {
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

    // Fire 60 rapid progress events simulating a large PDF
    const totalPages = 60;
    act(() => {
      for (let i = 1; i <= totalPages; i++) {
        emitMockEvent("lit:ocr-progress", {
          key: "smith2020",
          step: "Running Mistral OCR",
          detail: `page ${i} of ${totalPages}`,
        });
      }
    });

    // Verify the final progress text shows the last event
    await waitFor(() => {
      const progress = screen.getByTestId("ocr-progress");
      expect(progress).toHaveTextContent(`page ${totalPages} of ${totalPages}`);
      expect(progress).toHaveTextContent("Running Mistral OCR");
    });

    // Resolve the OCR promise and verify completion
    await act(async () => { resolveOcr("ocr/smith2020.md"); });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith("ocr/smith2020.md");
    });
  });

  it("error during overwrite flow is displayed", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "check_ocr_target_exists") return true;
      if (cmd === "ocr_pdf_to_markdown") throw new Error("Disk full");
      throw new Error(`Unknown: ${cmd}`);
    });

    const user = userEvent.setup();
    render(<OcrDialog {...defaultProps()} />);
    await user.click(screen.getByTestId("ocr-start-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("ocr-overwrite-confirm")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("ocr-overwrite-yes"));

    await waitFor(() => {
      expect(screen.getByTestId("ocr-error")).toHaveTextContent("Disk full");
    });
    expect(screen.getByTestId("ocr-start-btn")).not.toBeDisabled();
  });
});
