import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddReferenceDialog } from "./AddReferenceDialog";
import { mockInvoke } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { useStatusMessageStore } from "../stores/statusMessage";
import type { BibEntry } from "../lib/ipc";

const sampleEntry: BibEntry = {
  key: "smith2020",
  authors: ["Smith, John", "Doe, Jane"],
  title: "A Great Paper",
  year: "2020",
  entry_type: "article",
  line_number: 0,
  doi: "10.1000/xyz",
  journal: "Nature",
};

const sampleEntry2: BibEntry = {
  key: "jones2021",
  authors: ["Jones, A."],
  title: "Another Paper",
  year: "2021",
  entry_type: "article",
  line_number: 0,
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
    if (cmd === "list_bib_files") return ["/workspace/refs.bib", "/workspace/other.bib"];
    if (cmd === "lookup_doi") return sampleEntry;
    if (cmd === "save_bib_entry") return [{ Saved: { key: "smith2020" } }];
    if (cmd === "parse_csl_json") return [sampleEntry, sampleEntry2];
    if (cmd === "save_bib_entries")
      return [
        { Saved: { key: "smith2020" } },
        { Saved: { key: "jones2021" } },
      ];
    throw new Error(`Unknown command: ${cmd}`);
  });
});

describe("AddReferenceDialog", () => {
  // Group 1: Dialog open/close basics

  it("renders nothing when closed", () => {
    const { container } = render(
      <AddReferenceDialog open={false} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='add-reference-dialog']")).toBeNull();
  });

  it("renders dialog when open", () => {
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='add-reference-dialog']")).toBeTruthy();
  });

  it("Escape closes dialog", () => {
    const onClose = vi.fn();
    render(<AddReferenceDialog open={true} onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking backdrop closes dialog", () => {
    const onClose = vi.fn();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={onClose} onSaved={vi.fn()} />,
    );
    const backdrop = container.querySelector("[data-testid='add-reference-backdrop']")!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancel button calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={onClose} onSaved={vi.fn()} />,
    );
    const cancelBtn = container.querySelector("[data-testid='add-reference-cancel-btn']") as HTMLButtonElement;
    expect(cancelBtn).toBeTruthy();
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("resets state when reopened", async () => {
    const user = userEvent.setup();
    const { rerender, container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    // Type a DOI
    const input = container.querySelector("[data-testid='add-reference-doi-input']") as HTMLInputElement;
    await user.type(input, "10.1000/abc");
    expect(input.value).toBe("10.1000/abc");

    // Close
    rerender(<AddReferenceDialog open={false} onClose={vi.fn()} onSaved={vi.fn()} />);

    // Reopen
    rerender(<AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />);

    const newInput = container.querySelector("[data-testid='add-reference-doi-input']") as HTMLInputElement;
    expect(newInput.value).toBe("");
  });

  // Group 2: DOI mode

  it("DOI tab is active by default", () => {
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    const doiTab = container.querySelector("[data-testid='add-reference-mode-doi']") as HTMLButtonElement;
    expect(doiTab).toBeTruthy();
    // DOI input should be visible
    expect(container.querySelector("[data-testid='add-reference-doi-input']")).toBeTruthy();
  });

  it("lookup button is disabled when DOI input is empty", () => {
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    const lookupBtn = container.querySelector("[data-testid='add-reference-lookup-btn']") as HTMLButtonElement;
    expect(lookupBtn).toBeTruthy();
    expect(lookupBtn.disabled).toBe(true);
  });

  it("lookup button calls lookupDoi on click", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const input = container.querySelector("[data-testid='add-reference-doi-input']") as HTMLInputElement;
    await user.type(input, "10.1000/xyz");

    const lookupBtn = container.querySelector("[data-testid='add-reference-lookup-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(lookupBtn);
    });

    const call = invokedCommands.find((c) => c.cmd === "lookup_doi");
    expect(call).toBeTruthy();
    expect(call!.args).toEqual({ doi: "10.1000/xyz" });
  });

  it("shows loading state during lookup", async () => {
    let resolveLookup!: (value: BibEntry) => void;
    const deferred = new Promise<BibEntry>((r) => {
      resolveLookup = r;
    });
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "list_bib_files") return [];
      if (cmd === "lookup_doi") return deferred;
      throw new Error(`Unknown command: ${cmd}`);
    });

    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const input = container.querySelector("[data-testid='add-reference-doi-input']") as HTMLInputElement;
    await user.type(input, "10.1000/xyz");

    const lookupBtn = container.querySelector("[data-testid='add-reference-lookup-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(lookupBtn);
    });

    expect(container.querySelector("[data-testid='add-reference-loading']")).toBeTruthy();

    await act(async () => {
      resolveLookup(sampleEntry);
    });

    expect(container.querySelector("[data-testid='add-reference-loading']")).toBeNull();
  });

  it("displays preview card on successful lookup", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const input = container.querySelector("[data-testid='add-reference-doi-input']") as HTMLInputElement;
    await user.type(input, "10.1000/xyz");

    const lookupBtn = container.querySelector("[data-testid='add-reference-lookup-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(lookupBtn);
    });

    const preview = container.querySelector("[data-testid='add-reference-preview']");
    expect(preview).toBeTruthy();
    expect(preview!.textContent).toContain("A Great Paper");
    expect(preview!.textContent).toContain("Smith, John");
    expect(preview!.textContent).toContain("2020");
    expect(preview!.textContent).toContain("Nature");
  });

  it("displays error on lookup failure", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "list_bib_files") return [];
      if (cmd === "lookup_doi") throw new Error("DOI not found");
      throw new Error(`Unknown command: ${cmd}`);
    });

    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const input = container.querySelector("[data-testid='add-reference-doi-input']") as HTMLInputElement;
    await user.type(input, "10.9999/fake");

    const lookupBtn = container.querySelector("[data-testid='add-reference-lookup-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(lookupBtn);
    });

    const error = container.querySelector("[data-testid='add-reference-error']");
    expect(error).toBeTruthy();
    expect(error!.textContent).toContain("DOI not found");
  });

  it("save button calls saveBibEntry with correct args", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    // Lookup a DOI
    const input = container.querySelector("[data-testid='add-reference-doi-input']") as HTMLInputElement;
    await user.type(input, "10.1000/xyz");
    const lookupBtn = container.querySelector("[data-testid='add-reference-lookup-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(lookupBtn);
    });

    // Wait for bib files to load and select one
    await waitFor(() => {
      const select = container.querySelector("[data-testid='add-reference-bib-select']") as HTMLSelectElement;
      expect(select).toBeTruthy();
      expect(select.options.length).toBeGreaterThan(0);
    });

    const bibSelect = container.querySelector("[data-testid='add-reference-bib-select']") as HTMLSelectElement;
    fireEvent.change(bibSelect, { target: { value: "/workspace/refs.bib" } });

    // Click save
    const saveBtn = container.querySelector("[data-testid='add-reference-save-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    const call = invokedCommands.find((c) => c.cmd === "save_bib_entry");
    expect(call).toBeTruthy();
    expect(call!.args).toMatchObject({
      bibPath: "/workspace/refs.bib",
      workspacePath: "/workspace",
    });
  });

  it("save success shows toast and calls onSaved", async () => {
    const onSaved = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={onSaved} />,
    );

    // Lookup
    const input = container.querySelector("[data-testid='add-reference-doi-input']") as HTMLInputElement;
    await user.type(input, "10.1000/xyz");
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='add-reference-lookup-btn']")!);
    });

    // Select bib file
    await waitFor(() => {
      const select = container.querySelector("[data-testid='add-reference-bib-select']") as HTMLSelectElement;
      expect(select.options.length).toBeGreaterThan(0);
    });
    const bibSelect = container.querySelector("[data-testid='add-reference-bib-select']") as HTMLSelectElement;
    fireEvent.change(bibSelect, { target: { value: "/workspace/refs.bib" } });

    // Save
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='add-reference-save-btn']")!);
    });

    expect(onSaved).toHaveBeenCalled();
    const state = useStatusMessageStore.getState();
    expect(state.message).toContain("smith2020");
  });

  it("save duplicate DOI shows error toast", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "list_bib_files") return ["/workspace/refs.bib"];
      if (cmd === "lookup_doi") return sampleEntry;
      if (cmd === "save_bib_entry")
        return [{ DuplicateDoi: { doi: "10.1000/xyz", existing_key: "old2019" } }];
      throw new Error(`Unknown command: ${cmd}`);
    });

    const onSaved = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={onSaved} />,
    );

    const input = container.querySelector("[data-testid='add-reference-doi-input']") as HTMLInputElement;
    await user.type(input, "10.1000/xyz");
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='add-reference-lookup-btn']")!);
    });

    await waitFor(() => {
      const select = container.querySelector("[data-testid='add-reference-bib-select']") as HTMLSelectElement;
      expect(select.options.length).toBeGreaterThan(0);
    });
    fireEvent.change(container.querySelector("[data-testid='add-reference-bib-select']")!, {
      target: { value: "/workspace/refs.bib" },
    });

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='add-reference-save-btn']")!);
    });

    expect(onSaved).not.toHaveBeenCalled();
    const state = useStatusMessageStore.getState();
    expect(state.message).toContain("old2019");
    expect(state.variant).toBe("error");
  });

  it("Enter key in DOI input triggers lookup", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const input = container.querySelector("[data-testid='add-reference-doi-input']") as HTMLInputElement;
    await user.type(input, "10.1000/xyz");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    const call = invokedCommands.find((c) => c.cmd === "lookup_doi");
    expect(call).toBeTruthy();
  });

  it("Enter key does not trigger lookup while one is in-flight", async () => {
    let resolveLookup!: (value: BibEntry) => void;
    const deferred = new Promise<BibEntry>((r) => {
      resolveLookup = r;
    });
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "list_bib_files") return [];
      if (cmd === "lookup_doi") return deferred;
      throw new Error(`Unknown command: ${cmd}`);
    });

    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const input = container.querySelector("[data-testid='add-reference-doi-input']") as HTMLInputElement;
    await user.type(input, "10.1000/xyz");

    // First Enter: starts lookup
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // Second Enter while lookup is still pending
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    const lookupCalls = invokedCommands.filter((c) => c.cmd === "lookup_doi");
    expect(lookupCalls).toHaveLength(1);

    await act(async () => {
      resolveLookup(sampleEntry);
    });
  });

  it("Enter key does not trigger lookup when input is empty", async () => {
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const input = container.querySelector("[data-testid='add-reference-doi-input']") as HTMLInputElement;

    // Press Enter on empty input
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    let lookupCalls = invokedCommands.filter((c) => c.cmd === "lookup_doi");
    expect(lookupCalls).toHaveLength(0);

    // Type whitespace only, press Enter
    await act(async () => {
      fireEvent.change(input, { target: { value: "   " } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    lookupCalls = invokedCommands.filter((c) => c.cmd === "lookup_doi");
    expect(lookupCalls).toHaveLength(0);
  });

  // Group 3: Import mode

  it("switching to Import tab shows file picker UI", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const importTab = container.querySelector("[data-testid='add-reference-mode-import']") as HTMLButtonElement;
    await user.click(importTab);

    expect(container.querySelector("[data-testid='add-reference-import-file-btn']")).toBeTruthy();
    // DOI input should be gone
    expect(container.querySelector("[data-testid='add-reference-doi-input']")).toBeNull();
  });

  it("choosing a file calls open dialog and parseCslJson", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/workspace/export.json");

    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const importTab = container.querySelector("[data-testid='add-reference-mode-import']")!;
    await user.click(importTab);

    const chooseBtn = container.querySelector("[data-testid='add-reference-import-file-btn']")!;
    await act(async () => {
      fireEvent.click(chooseBtn);
    });

    await waitFor(() => {
      expect(container.querySelector("[data-testid='add-reference-import-preview']")).toBeTruthy();
    });

    const parseCall = invokedCommands.find((c) => c.cmd === "parse_csl_json");
    expect(parseCall).toBeTruthy();
  });

  it("import button calls saveBibEntries", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/workspace/export.json");

    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    // Switch to import
    await user.click(container.querySelector("[data-testid='add-reference-mode-import']")!);

    // Choose file
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='add-reference-import-file-btn']")!);
    });

    await waitFor(() => {
      expect(container.querySelector("[data-testid='add-reference-import-preview']")).toBeTruthy();
    });

    // Select bib file
    await waitFor(() => {
      const select = container.querySelector("[data-testid='add-reference-bib-select']") as HTMLSelectElement;
      expect(select).toBeTruthy();
      expect(select.options.length).toBeGreaterThan(0);
    });
    fireEvent.change(container.querySelector("[data-testid='add-reference-bib-select']")!, {
      target: { value: "/workspace/refs.bib" },
    });

    // Import
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='add-reference-save-btn']")!);
    });

    const call = invokedCommands.find((c) => c.cmd === "save_bib_entries");
    expect(call).toBeTruthy();
    expect(call!.args).toMatchObject({
      bibPath: "/workspace/refs.bib",
      workspacePath: "/workspace",
    });
    expect((call!.args as { entries: unknown[] }).entries).toHaveLength(2);
  });

  it("import success shows summary toast", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/workspace/export.json");

    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "list_bib_files") return ["/workspace/refs.bib"];
      if (cmd === "parse_csl_json") return [sampleEntry, sampleEntry2];
      if (cmd === "save_bib_entries")
        return [
          { Saved: { key: "smith2020" } },
          { DuplicateDoi: { doi: "10.1000/xyz", existing_key: "old" } },
        ];
      throw new Error(`Unknown command: ${cmd}`);
    });

    const onSaved = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={onSaved} />,
    );

    await user.click(container.querySelector("[data-testid='add-reference-mode-import']")!);
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='add-reference-import-file-btn']")!);
    });
    await waitFor(() => {
      expect(container.querySelector("[data-testid='add-reference-import-preview']")).toBeTruthy();
    });

    await waitFor(() => {
      const select = container.querySelector("[data-testid='add-reference-bib-select']") as HTMLSelectElement;
      expect(select.options.length).toBeGreaterThan(0);
    });
    fireEvent.change(container.querySelector("[data-testid='add-reference-bib-select']")!, {
      target: { value: "/workspace/refs.bib" },
    });

    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='add-reference-save-btn']")!);
    });

    expect(onSaved).toHaveBeenCalled();
    const state = useStatusMessageStore.getState();
    expect(state.message).toMatch(/1.*saved/i);
    expect(state.message).toMatch(/1.*duplicate/i);
  });

  it("import with invalid JSON shows error", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/workspace/bad.json");

    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "list_bib_files") return ["/workspace/refs.bib"];
      if (cmd === "parse_csl_json") throw new Error("Invalid JSON");
      throw new Error(`Unknown command: ${cmd}`);
    });

    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    await user.click(container.querySelector("[data-testid='add-reference-mode-import']")!);
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='add-reference-import-file-btn']")!);
    });

    await waitFor(() => {
      const error = container.querySelector("[data-testid='add-reference-error']");
      expect(error).toBeTruthy();
      expect(error!.textContent).toContain("Invalid JSON");
    });
  });

  // Group 4: Shared bib file picker

  it("loads existing bib files on open", async () => {
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    await waitFor(() => {
      const select = container.querySelector("[data-testid='add-reference-bib-select']") as HTMLSelectElement;
      expect(select).toBeTruthy();
      // Should have the two mock files plus a "new file" option
      const options = Array.from(select.options).map((o) => o.value);
      expect(options).toContain("/workspace/refs.bib");
      expect(options).toContain("/workspace/other.bib");
    });
  });

  it("allows typing a new bib file path", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    await waitFor(() => {
      expect(container.querySelector("[data-testid='add-reference-bib-select']")).toBeTruthy();
    });

    // Select "new file" option
    const bibSelect = container.querySelector("[data-testid='add-reference-bib-select']") as HTMLSelectElement;
    fireEvent.change(bibSelect, { target: { value: "__new__" } });

    const newInput = container.querySelector("[data-testid='add-reference-bib-new-input']") as HTMLInputElement;
    expect(newInput).toBeTruthy();
    await user.clear(newInput);
    await user.type(newInput, "custom.bib");
    expect(newInput.value).toBe("custom.bib");
  });

  it("defaults to refs.bib when no bib files exist", async () => {
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args: args ?? {} });
      if (cmd === "list_bib_files") return [];
      if (cmd === "lookup_doi") return sampleEntry;
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    await waitFor(() => {
      const newInput = container.querySelector("[data-testid='add-reference-bib-new-input']") as HTMLInputElement;
      expect(newInput).toBeTruthy();
      expect(newInput.value).toBe("refs.bib");
    });
  });

  // Group 5: Disabled states

  it("save disabled when no bib file selected", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    // Lookup DOI to get a preview
    const input = container.querySelector("[data-testid='add-reference-doi-input']") as HTMLInputElement;
    await user.type(input, "10.1000/xyz");
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='add-reference-lookup-btn']")!);
    });

    // Wait for preview
    await waitFor(() => {
      expect(container.querySelector("[data-testid='add-reference-preview']")).toBeTruthy();
    });

    // Clear bib selection to empty
    const bibSelect = container.querySelector("[data-testid='add-reference-bib-select']") as HTMLSelectElement;
    fireEvent.change(bibSelect, { target: { value: "" } });

    const saveBtn = container.querySelector("[data-testid='add-reference-save-btn']") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("save disabled when no lookup result in DOI mode", () => {
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const saveBtn = container.querySelector("[data-testid='add-reference-save-btn']") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("import disabled when no entries parsed in Import mode", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AddReferenceDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    await user.click(container.querySelector("[data-testid='add-reference-mode-import']")!);

    const saveBtn = container.querySelector("[data-testid='add-reference-save-btn']") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });
});
