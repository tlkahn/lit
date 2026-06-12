import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import { ImportPdfDialog } from "./ImportPdfDialog";
import { mockInvoke } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { useStatusMessageStore } from "../stores/statusMessage";
import type { BibEntry, RecognizeResult } from "../lib/ipc";

const samplePrefilled: BibEntry = {
  key: "manual2024",
  authors: ["Smith, John", "Doe, Jane"],
  title: "A Manually Confirmed Paper",
  year: "2024",
  entry_type: "article",
  line_number: 0,
  doi: "10.1000/manual",
  journal: "Science",
};

const resolvedResult: RecognizeResult = {
  kind: "resolved",
  outcome: { Saved: { key: "kucsko2013" } },
  source: "DoiContentNegotiation",
  validation: "validated",
  file: "papers/kucsko2013.pdf",
  entry: {
    key: "entry_key_different",
    authors: ["Kucsko, G."],
    title: "Resolved Paper",
    year: "2013",
    entry_type: "article",
    line_number: 0,
  },
};

const needsConfirmResult: RecognizeResult = {
  kind: "needs_confirmation",
  reason: "no_text_layer",
  prefilled: samplePrefilled,
  file: "papers/manual2024.pdf",
  message: null,
};

let invokedCommands: { cmd: string; args: Record<string, unknown> }[];

beforeEach(() => {
  invokedCommands = [];
  useWorkspaceStore.setState({
    workspacePath: "/workspace",
    pages: [],
    currentPagePath: null,
    currentPageHeadings: [],
    loading: false,
    error: null,
  });
  useStatusMessageStore.setState({ message: null, variant: "success" });

  mockInvoke((cmd, args) => {
    invokedCommands.push({ cmd, args: args ?? {} });
    if (cmd === "recognize_pdf") return resolvedResult;
    if (cmd === "import_recognized_entry") return [{ Saved: { key: "manual2024" } }];
    throw new Error(`Unknown command: ${cmd}`);
  });
});

describe("ImportPdfDialog", () => {
  // Group 1: Dialog open/close basics

  it("renders nothing when closed", () => {
    const { container } = render(
      <ImportPdfDialog open={false} onClose={vi.fn()} onImported={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='import-pdf-dialog']")).toBeNull();
  });

  it("renders dialog when open", () => {
    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='import-pdf-dialog']")).toBeTruthy();
  });

  it("Escape closes dialog", () => {
    const onClose = vi.fn();
    render(<ImportPdfDialog open={true} onClose={onClose} onImported={vi.fn()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking backdrop closes dialog", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ImportPdfDialog open={true} onClose={onClose} onImported={vi.fn()} />,
    );
    const backdrop = container.querySelector("[data-testid='import-pdf-backdrop']")!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancel button calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ImportPdfDialog open={true} onClose={onClose} onImported={vi.fn()} />,
    );
    const cancelBtn = container.querySelector("[data-testid='import-pdf-cancel-btn']") as HTMLButtonElement;
    expect(cancelBtn).toBeTruthy();
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("resets state when reopened", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const { rerender, container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    // Trigger a flow by choosing a PDF
    const chooseBtn = container.querySelector("[data-testid='import-pdf-choose-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(chooseBtn);
    });

    // Close
    rerender(<ImportPdfDialog open={false} onClose={vi.fn()} onImported={vi.fn()} />);

    // Reopen
    rerender(<ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />);

    // Should be back in idle (Choose PDF button visible)
    expect(container.querySelector("[data-testid='import-pdf-choose-btn']")).toBeTruthy();
  });

  // Group 2: Idle phase

  it("shows Choose PDF button in idle state", () => {
    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='import-pdf-choose-btn']")).toBeTruthy();
  });

  it("does not render BibFilePicker", () => {
    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='import-pdf-bib-select']")).toBeNull();
    expect(container.querySelector("[data-testid='import-pdf-bib-new-input']")).toBeNull();
  });

  // Group 3: Progress phase (resolved result)

  it("clicking Choose PDF opens file dialog and starts recognition", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    const chooseBtn = container.querySelector("[data-testid='import-pdf-choose-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(chooseBtn);
    });

    await waitFor(() => {
      const call = invokedCommands.find((c) => c.cmd === "recognize_pdf");
      expect(call).toBeTruthy();
      expect(call!.args).toMatchObject({
        pdfPath: "/path/to/paper.pdf",
        workspacePath: "/workspace",
      });
    });
  });

  it("shows spinner during recognition", async () => {
    let resolveRecognize!: (value: RecognizeResult) => void;
    const deferred = new Promise<RecognizeResult>((r) => {
      resolveRecognize = r;
    });
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") return deferred;
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    const chooseBtn = container.querySelector("[data-testid='import-pdf-choose-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(chooseBtn);
    });

    expect(container.querySelector("[data-testid='import-pdf-spinner']")).toBeTruthy();

    await act(async () => {
      resolveRecognize(resolvedResult);
    });
  });

  it("resolved result with Saved outcome shows success toast and closes", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const onImported = vi.fn();
    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={onImported} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      const state = useStatusMessageStore.getState();
      expect(state.message).toContain("@kucsko2013");
    });
    expect(onImported).toHaveBeenCalled();
  });

  it("resolved result with SavedNoDoi outcome shows correct toast", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") return {
        ...resolvedResult,
        outcome: { SavedNoDoi: { key: "manual2024" } },
      };
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const onImported = vi.fn();
    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={onImported} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      const state = useStatusMessageStore.getState();
      expect(state.message).toContain("@manual2024");
      expect(state.message).toContain("no DOI");
    });
    expect(onImported).toHaveBeenCalled();
  });

  it("resolved result with DuplicateDoi outcome shows duplicate toast", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") return {
        ...resolvedResult,
        outcome: { DuplicateDoi: { doi: "10.1/x", existing_key: "old2019" } },
      };
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const onImported = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <ImportPdfDialog open={true} onClose={onClose} onImported={onImported} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      const state = useStatusMessageStore.getState();
      expect(state.message).toContain("old2019");
      expect(state.variant).toBe("error");
    });
    expect(onImported).not.toHaveBeenCalled();
    // Dialog must NOT remain stuck on progress phase -- onClose must be called
    expect(onClose).toHaveBeenCalled();
  });

  it("user cancels file dialog (null path) stays in idle", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    const chooseBtn = container.querySelector("[data-testid='import-pdf-choose-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(chooseBtn);
    });

    // Should stay in idle - Choose PDF button still visible
    expect(container.querySelector("[data-testid='import-pdf-choose-btn']")).toBeTruthy();
    const recognizeCalls = invokedCommands.filter((c) => c.cmd === "recognize_pdf");
    expect(recognizeCalls).toHaveLength(0);
  });

  // Group 4: needs_confirmation result

  it("needs_confirmation result shows confirm form with reason banner", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") return needsConfirmResult;
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      const banner = container.querySelector("[data-testid='import-pdf-reason-banner']");
      expect(banner).toBeTruthy();
      expect(banner!.textContent).toMatch(/no text layer/i);
    });
    // Editable fields should be visible
    expect(container.querySelector("[data-testid='import-pdf-field-title']")).toBeTruthy();
    expect(container.querySelector("[data-testid='import-pdf-field-authors']")).toBeTruthy();
    expect(container.querySelector("[data-testid='import-pdf-field-year']")).toBeTruthy();
  });

  it("needs_confirmation with no_identifier shows generic message", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") return {
        ...needsConfirmResult,
        reason: "no_identifier",
      };
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      const banner = container.querySelector("[data-testid='import-pdf-reason-banner']");
      expect(banner).toBeTruthy();
      expect(banner!.textContent).toMatch(/couldn.*t find a confident match/i);
    });
  });

  it("needs_confirmation with no_match shows generic message", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") return {
        ...needsConfirmResult,
        reason: "no_match",
      };
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      const banner = container.querySelector("[data-testid='import-pdf-reason-banner']");
      expect(banner).toBeTruthy();
      expect(banner!.textContent).toMatch(/couldn.*t find a confident match/i);
    });
  });

  it("needs_confirmation with offline_error shows message and Retry button", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") return {
        ...needsConfirmResult,
        reason: "offline_error",
        message: "Network unreachable",
      };
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      const banner = container.querySelector("[data-testid='import-pdf-reason-banner']");
      expect(banner).toBeTruthy();
      expect(banner!.textContent).toContain("Network unreachable");
    });
    expect(container.querySelector("[data-testid='import-pdf-retry-btn']")).toBeTruthy();
  });

  it("confirm form pre-fills fields from prefilled entry", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") return needsConfirmResult;
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      const title = container.querySelector("[data-testid='import-pdf-field-title']") as HTMLInputElement;
      expect(title).toBeTruthy();
      expect(title.value).toBe("A Manually Confirmed Paper");
    });

    const authors = container.querySelector("[data-testid='import-pdf-field-authors']") as HTMLInputElement;
    expect(authors.value).toBe("Smith, John; Doe, Jane");

    const year = container.querySelector("[data-testid='import-pdf-field-year']") as HTMLInputElement;
    expect(year.value).toBe("2024");

    const entryType = container.querySelector("[data-testid='import-pdf-field-entry-type']") as HTMLSelectElement;
    expect(entryType.value).toBe("article");
  });

  it("editing fields and clicking Save calls importRecognizedEntry", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") return needsConfirmResult;
      if (cmd === "import_recognized_entry") return [{ Saved: { key: "manual2024" } }];
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const onImported = vi.fn();
    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={onImported} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      expect(container.querySelector("[data-testid='import-pdf-field-title']")).toBeTruthy();
    });

    // Edit the title
    const titleInput = container.querySelector("[data-testid='import-pdf-field-title']") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Edited Title" } });

    // Click save
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-confirm-save-btn']")!);
    });

    const call = invokedCommands.find((c) => c.cmd === "import_recognized_entry");
    expect(call).toBeTruthy();
    expect((call!.args as { entry: { title: string } }).entry.title).toBe("Edited Title");
  });

  it("Save on confirm form preserves file field unchanged", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") return needsConfirmResult;
      if (cmd === "import_recognized_entry") return [{ Saved: { key: "manual2024" } }];
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      expect(container.querySelector("[data-testid='import-pdf-field-title']")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-confirm-save-btn']")!);
    });

    const call = invokedCommands.find((c) => c.cmd === "import_recognized_entry");
    expect(call).toBeTruthy();
    expect((call!.args as { entry: { file: string } }).entry.file).toBe("papers/manual2024.pdf");
  });

  it("confirm form save preserves prefilled issn not in form fields", async () => {
    const prefilledWithIssn: BibEntry = {
      ...samplePrefilled,
      issn: "1234-5678",
    };
    const confirmResultWithIssn: RecognizeResult = {
      kind: "needs_confirmation",
      reason: "no_text_layer",
      prefilled: prefilledWithIssn,
      file: "papers/manual2024.pdf",
      message: null,
    };

    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") return confirmResultWithIssn;
      if (cmd === "import_recognized_entry") return [{ Saved: { key: "manual2024" } }];
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      expect(container.querySelector("[data-testid='import-pdf-field-title']")).toBeTruthy();
    });

    // Click save without editing anything
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-confirm-save-btn']")!);
    });

    const call = invokedCommands.find((c) => c.cmd === "import_recognized_entry");
    expect(call).toBeTruthy();
    const savedEntry = (call!.args as { entry: BibEntry }).entry;
    // The ISSN from prefilled must survive into the saved entry
    expect(savedEntry.issn).toBe("1234-5678");
    // Form-edited fields must also be present
    expect(savedEntry.title).toBe("A Manually Confirmed Paper");
    expect(savedEntry.doi).toBe("10.1000/manual");
    expect(savedEntry.file).toBe("papers/manual2024.pdf");
  });

  it("confirm form save splits authors on semicolons only, preserving Last, First format", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") return needsConfirmResult;
      if (cmd === "import_recognized_entry") return [{ Saved: { key: "manual2024" } }];
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      expect(container.querySelector("[data-testid='import-pdf-field-title']")).toBeTruthy();
    });

    // The prefilled authors field should show "Smith, John; Doe, Jane"
    const authorsInput = container.querySelector(
      "[data-testid='import-pdf-field-authors']",
    ) as HTMLInputElement;
    expect(authorsInput.value).toBe("Smith, John; Doe, Jane");

    // Click save WITHOUT editing the authors field -- the prefilled value round-trips
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-confirm-save-btn']")!);
    });

    const call = invokedCommands.find((c) => c.cmd === "import_recognized_entry");
    expect(call).toBeTruthy();
    const savedEntry = (call!.args as { entry: BibEntry }).entry;
    // Must produce exactly 2 authors, not 4 corrupt fragments
    expect(savedEntry.authors).toEqual(["Smith, John", "Doe, Jane"]);
  });

  it("confirm form save success shows toast with key from SaveOutcome", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") return needsConfirmResult;
      if (cmd === "import_recognized_entry") return [{ Saved: { key: "savedkey2024" } }];
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const onImported = vi.fn();
    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={onImported} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      expect(container.querySelector("[data-testid='import-pdf-field-title']")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-confirm-save-btn']")!);
    });

    await waitFor(() => {
      const state = useStatusMessageStore.getState();
      // Must use key from SaveOutcome, not from prefilled entry
      expect(state.message).toContain("@savedkey2024");
    });
    expect(onImported).toHaveBeenCalled();
  });

  it("confirm form save error shows error banner", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") return needsConfirmResult;
      if (cmd === "import_recognized_entry") throw new Error("Write failed");
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      expect(container.querySelector("[data-testid='import-pdf-field-title']")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-confirm-save-btn']")!);
    });

    await waitFor(() => {
      const errorBanner = container.querySelector("[data-testid='import-pdf-error-banner']");
      expect(errorBanner).toBeTruthy();
      expect(errorBanner!.textContent).toContain("Write failed");
    });
  });

  it("confirm form save with DuplicateDoi closes dialog after toast", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") return needsConfirmResult;
      if (cmd === "import_recognized_entry")
        return [{ DuplicateDoi: { doi: "10.1/x", existing_key: "old2019" } }];
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const onImported = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <ImportPdfDialog open={true} onClose={onClose} onImported={onImported} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      expect(container.querySelector("[data-testid='import-pdf-field-title']")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-confirm-save-btn']")!);
    });

    await waitFor(() => {
      const state = useStatusMessageStore.getState();
      expect(state.message).toContain("old2019");
      expect(state.variant).toBe("error");
    });
    expect(onImported).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // Group 5: Error phase

  it("recognize_pdf error shows error banner with retry", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") throw new Error("PDF processing failed");
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      const errorBanner = container.querySelector("[data-testid='import-pdf-error-banner']");
      expect(errorBanner).toBeTruthy();
      expect(errorBanner!.textContent).toContain("PDF processing failed");
    });
    expect(container.querySelector("[data-testid='import-pdf-retry-btn']")).toBeTruthy();
  });

  it("clicking Retry in error state re-invokes recognizePdf", async () => {
    let callCount = 0;
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") {
        callCount++;
        if (callCount === 1) throw new Error("PDF processing failed");
        return resolvedResult;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      expect(container.querySelector("[data-testid='import-pdf-retry-btn']")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-retry-btn']")!);
    });

    const recognizeCalls = invokedCommands.filter((c) => c.cmd === "recognize_pdf");
    expect(recognizeCalls.length).toBe(2);
  });

  it("clicking Retry in offline_error confirm state re-invokes recognizePdf", async () => {
    let callCount = 0;
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "recognize_pdf") {
        callCount++;
        if (callCount === 1) return {
          ...needsConfirmResult,
          reason: "offline_error",
          message: "Network unreachable",
        };
        return resolvedResult;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/path/to/paper.pdf");

    const { container } = render(
      <ImportPdfDialog open={true} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-choose-btn']")!);
    });

    await waitFor(() => {
      expect(container.querySelector("[data-testid='import-pdf-retry-btn']")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='import-pdf-retry-btn']")!);
    });

    await waitFor(() => {
      const recognizeCalls = invokedCommands.filter((c) => c.cmd === "recognize_pdf");
      expect(recognizeCalls.length).toBe(2);
    });
  });
});
