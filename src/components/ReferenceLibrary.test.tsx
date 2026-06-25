import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockInvoke,
  mockListen,
  resetListenMock,
  emitMockEvent,
  mockOnDragDropEvent,
  emitDragDropEvent,
  mockDialogOpen,
} from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { useStatusMessageStore } from "../stores/statusMessage";
import { ReferenceLibrary, findBibKeyForPage, findActiveLetter } from "./ReferenceLibrary";
import { globalJumpTracker } from "../editor/jumpTracker";
import { setCurrentEditorView } from "../lib/editorViewRef";
import type { BibEntry, BacklinkEntry, BibKeyState } from "../lib/ipc";

const sanderson: BibEntry = {
  key: "sanderson2009",
  authors: ["Sanderson, Alexis"],
  title: "The Saiva Age",
  year: "2009",
  entry_type: "article",
  line_number: 1,
  bib_file: "/workspace/refs.bib",
  journal: "Journal of Indology",
  doi: "10.1000/xyz",
  url: "https://example.org/a",
  abstract_text: "A long abstract about Saivism.",
  tags: ["tantra", "history"],
};

const flood: BibEntry = {
  key: "flood1996",
  authors: ["Flood, Gavin"],
  title: "An Introduction to Hinduism",
  year: "1996",
  entry_type: "book",
  line_number: 1,
  bib_file: "/workspace/refs.bib",
  tags: [],
};

const abrams: BibEntry = {
  key: "abrams2001",
  authors: ["Abrams, M."],
  title: "Aardvark",
  year: "2001",
  entry_type: "article",
  line_number: 1,
  bib_file: "/workspace/refs.bib",
};

let invokedCommands: { cmd: string; args: unknown }[] = [];
let fixture: BibEntry[] = [];
let citingFixture: BacklinkEntry[] = [];
let bibKeyStatesFixture: Record<string, { materialization: string; page_id: string | null }> = {};
let refCountsFixture: Record<string, number> = {};
let clipboardOverridden = false;
const origClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function makeCiting(overrides: Partial<BacklinkEntry> = {}): BacklinkEntry {
  return {
    source_id: "notes/a.md",
    source_title: "Note A",
    context: "see [@sanderson2009]",
    source_line: 4,
    ...overrides,
  };
}

function setClipboardMock(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  clipboardOverridden = true;
}

beforeEach(() => {
  invokedCommands = [];
  fixture = [sanderson, flood, abrams];
  citingFixture = [];
  bibKeyStatesFixture = {};
  refCountsFixture = {};
  resetListenMock();
  mockListen();
  useWorkspaceStore.setState({
    workspacePath: "/workspace",
    pages: [],
    currentPagePath: null,
    currentPageHeadings: [],
    loading: false,
    error: null,
    graphReady: true,
  });
  useStatusMessageStore.setState({ message: null, variant: "success" });

  mockInvoke((cmd, args) => {
    invokedCommands.push({ cmd, args });
    if (cmd === "list_bib_entries") return fixture;
    if (cmd === "get_citing_pages") return citingFixture;
    if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
    if (cmd === "get_reference_counts") return refCountsFixture;
    throw new Error(`Unknown command: ${cmd}`);
  });
});

afterEach(() => {
  if (clipboardOverridden) {
    if (origClipboard) {
      Object.defineProperty(navigator, "clipboard", origClipboard);
    } else {
      // @ts-expect-error cleanup
      delete navigator.clipboard;
    }
    clipboardOverridden = false;
  }
});

describe("ReferenceLibrary", () => {
  it("fetches entries on mount via list_bib_entries", async () => {
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    const call = invokedCommands.find((c) => c.cmd === "list_bib_entries");
    expect(call).toBeTruthy();
    expect(call!.args).toEqual({ workspacePath: "/workspace" });
  });

  it("renders entries sorted by author last name ascending", async () => {
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("Aardvark")).toBeInTheDocument());
    const titles = screen.getAllByTestId("reference-entry-title").map((el) => el.textContent);
    expect(titles).toEqual([
      "Aardvark", // Abrams
      "An Introduction to Hinduism", // Flood
      "The Saiva Age", // Sanderson
    ]);
  });

  it("shows empty state when there are no entries", async () => {
    fixture = [];
    render(<ReferenceLibrary />);
    await waitFor(() =>
      expect(screen.getByText(/No references found/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/\.bib/i)).toBeInTheDocument();
  });

  it("search filters across title", async () => {
    const user = userEvent.setup();
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Search references"), "Hinduism");

    expect(await screen.findByText("An Introduction to Hinduism")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("The Saiva Age")).not.toBeInTheDocument(),
    );
  });

  it("search matches tags", async () => {
    const user = userEvent.setup();
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Search references"), "tantra");

    expect(await screen.findByText("The Saiva Age")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Aardvark")).not.toBeInTheDocument(),
    );
  });

  it("search matches author", async () => {
    const user = userEvent.setup();
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Search references"), "Sanderson");

    expect(await screen.findByText("The Saiva Age")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Aardvark")).not.toBeInTheDocument(),
    );
  });

  it("clicking an entry expands its metadata card", async () => {
    const user = userEvent.setup();
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));

    expect(screen.getByText("Journal of Indology")).toBeInTheDocument();
    expect(screen.getByText("A long abstract about Saivism.")).toBeInTheDocument();
    expect(screen.getByText("tantra")).toBeInTheDocument();
    expect(screen.getByText("history")).toBeInTheDocument();

    const doiLink = screen.getByRole("link", { name: /10\.1000\/xyz/i });
    expect(doiLink).toHaveAttribute("href", "https://doi.org/10.1000/xyz");

    const urlLink = screen.getByRole("link", { name: /example\.org/i });
    expect(urlLink).toHaveAttribute("href", "https://example.org/a");
  });

  it("only one card expanded at a time", async () => {
    const user = userEvent.setup();
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    expect(screen.getByText("A long abstract about Saivism.")).toBeInTheDocument();

    await user.click(screen.getByText("An Introduction to Hinduism"));
    expect(screen.queryByText("A long abstract about Saivism.")).not.toBeInTheDocument();
  });

  it("clicking an expanded entry collapses it", async () => {
    const user = userEvent.setup();
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    const rowTitle = () =>
      screen
        .getAllByTestId("reference-entry-title")
        .find((el) => el.textContent === "The Saiva Age")!;

    await user.click(rowTitle());
    expect(screen.getByText("A long abstract about Saivism.")).toBeInTheDocument();

    await user.click(rowTitle());
    expect(screen.queryByText("A long abstract about Saivism.")).not.toBeInTheDocument();
  });

  it("copy citation writes [@key] to clipboard and shows status", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboardMock(writeText);

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    const rowTitle = screen
      .getAllByTestId("reference-entry-title")
      .find((el) => el.textContent === "The Saiva Age")!;
    await user.click(rowTitle);
    await user.click(screen.getByRole("button", { name: /Copy citation/i }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("[@sanderson2009]"),
    );
    await waitFor(() =>
      expect(useStatusMessageStore.getState().message).toMatch(/Copied/i),
    );
  });

  it("sparse entry: absent doi/url/journal/abstract do not render those rows", async () => {
    const user = userEvent.setup();
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("An Introduction to Hinduism")).toBeInTheDocument());

    await user.click(screen.getByText("An Introduction to Hinduism"));

    expect(screen.queryByRole("link", { name: /doi\.org/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Journal of Indology")).not.toBeInTheDocument();
    expect(screen.queryByText("A long abstract about Saivism.")).not.toBeInTheDocument();
    expect(screen.queryByText("tantra")).not.toBeInTheDocument();
  });

  it("search matches citation key case-insensitively", async () => {
    const user = userEvent.setup();
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Search references"), "SANDERSON2009");

    expect(await screen.findByText("The Saiva Age")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Aardvark")).not.toBeInTheDocument(),
    );
  });

  it("renders a javascript: url as an inert href", async () => {
    const user = userEvent.setup();
    fixture = [
      {
        key: "evil2020",
        authors: ["Hacker, H."],
        title: "Untrusted Entry",
        year: "2020",
        entry_type: "article",
        line_number: 1,
        bib_file: "/workspace/evil.bib",
        url: "javascript:alert(document.cookie)",
      },
    ];
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("Untrusted Entry")).toBeInTheDocument());

    await user.click(screen.getByText("Untrusted Entry"));

    screen.queryAllByRole("link").forEach((l) => {
      expect(l.getAttribute("href")).not.toMatch(/^javascript:/i);
    });
    const urlLink = screen.getByRole("link", {
      name: /javascript:alert/i,
    });
    expect(urlLink).toHaveAttribute("href", "#");
  });

  it("renders duplicate citation keys from different .bib files without collision", async () => {
    const user = userEvent.setup();
    fixture = [
      {
        key: "smith2020",
        authors: ["Smith, Alice"],
        title: "Smith Paper One",
        year: "2020",
        entry_type: "article",
        line_number: 1,
        bib_file: "/ws/a.bib",
        abstract_text: "ALPHA-UNIQUE-ABSTRACT",
      },
      {
        key: "smith2020",
        authors: ["Smith, Bob"],
        title: "Smith Paper Two",
        year: "2021",
        entry_type: "article",
        line_number: 1,
        bib_file: "/ws/b.bib",
        abstract_text: "BETA-UNIQUE-ABSTRACT",
      },
    ];
    render(<ReferenceLibrary />);
    await waitFor(() =>
      expect(screen.getByText("Smith Paper One")).toBeInTheDocument(),
    );
    expect(screen.getAllByTestId("reference-entry-title")).toHaveLength(2);

    await user.click(screen.getByText("Smith Paper One"));

    expect(screen.getByText("ALPHA-UNIQUE-ABSTRACT")).toBeInTheDocument();
    expect(screen.queryByText("BETA-UNIQUE-ABSTRACT")).not.toBeInTheDocument();
  });

  it("renders duplicate tags without React key collision", async () => {
    const user = userEvent.setup();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fixture = [
      {
        key: "dups2020",
        authors: ["Dup, D."],
        title: "Duplicate Tags Entry",
        year: "2020",
        entry_type: "article",
        line_number: 1,
        bib_file: "/workspace/dups.bib",
        tags: ["ml", "nlp", "ml"],
      },
    ];
    render(<ReferenceLibrary />);
    await waitFor(() =>
      expect(screen.getByText("Duplicate Tags Entry")).toBeInTheDocument(),
    );

    await user.click(screen.getByText("Duplicate Tags Entry"));

    expect(screen.getAllByText("ml")).toHaveLength(2);
    expect(screen.getAllByText("nlp")).toHaveLength(1);
    expect(errSpy.mock.calls.flat().join(" ")).not.toMatch(
      /Encountered two children with the same key/,
    );
    errSpy.mockRestore();
  });

  it("re-fetches when a .bib file is modified", async () => {
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    const before = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
    fixture = [
      { ...sanderson, title: "The Saiva Age (edited)" },
      flood,
      abrams,
    ];
    emitMockEvent("workspace://file-modified", { path: "refs.bib" });

    await waitFor(() =>
      expect(screen.getByText("The Saiva Age (edited)")).toBeInTheDocument(),
    );
    const after = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
    expect(after).toBeGreaterThan(before);
  });

  it("re-fetches when a .bib file is created (starting empty)", async () => {
    fixture = [];
    render(<ReferenceLibrary />);
    await waitFor(() =>
      expect(screen.getByText(/No references found/i)).toBeInTheDocument(),
    );

    fixture = [sanderson];
    emitMockEvent("workspace://file-created", { path: "new.bib" });

    await waitFor(() =>
      expect(screen.getByText("The Saiva Age")).toBeInTheDocument(),
    );
  });

  it("re-fetches when a .bib file is deleted", async () => {
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    fixture = [];
    emitMockEvent("workspace://file-deleted", { path: "refs.bib" });

    await waitFor(() =>
      expect(screen.getByText(/No references found/i)).toBeInTheDocument(),
    );
  });

  it("ignores non-.bib file events", async () => {
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    const before = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
    emitMockEvent("workspace://file-modified", { path: "note.md" });
    emitMockEvent("workspace://file-created", { path: "paper.pdf" });

    // Give any erroneous re-fetch a chance to fire.
    await new Promise((r) => setTimeout(r, 20));
    const after = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
    expect(after).toBe(before);
  });

  it("unsubscribes from file events on unmount", async () => {
    const { unmount } = render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    unmount();

    const before = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
    emitMockEvent("workspace://file-modified", { path: "refs.bib" });
    await new Promise((r) => setTimeout(r, 20));
    const after = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
    expect(after).toBe(before);
  });

  it("discards stale IPC results after a workspace switch", async () => {
    let resolveA!: (value: BibEntry[]) => void;
    const deferredA = new Promise<BibEntry[]>((r) => {
      resolveA = r;
    });

    let callCount = 0;
    mockInvoke((cmd) => {
      invokedCommands.push({ cmd, args: undefined });
      if (cmd === "list_bib_entries") {
        callCount++;
        if (callCount === 1) return deferredA;
        return [{ ...flood, title: "Fresh from B" }];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);

    useWorkspaceStore.setState({ workspacePath: "/workspace-b" });
    await waitFor(() =>
      expect(screen.getByText("Fresh from B")).toBeInTheDocument(),
    );

    resolveA([{ ...sanderson, title: "Stale from A" }]);
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText("Stale from A")).not.toBeInTheDocument();
    expect(screen.getByText("Fresh from B")).toBeInTheDocument();
  });

  describe("debounce", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("collapses rapid .bib events into a single IPC call", async () => {
      render(<ReferenceLibrary />);
      await vi.advanceTimersByTimeAsync(100);
      expect(screen.getByText("The Saiva Age")).toBeInTheDocument();

      const before = invokedCommands.filter(
        (c) => c.cmd === "list_bib_entries",
      ).length;

      for (let i = 0; i < 5; i++) {
        emitMockEvent("workspace://file-modified", {
          path: `ref${i}.bib`,
        });
      }

      await vi.advanceTimersByTimeAsync(250);

      const after = invokedCommands.filter(
        (c) => c.cmd === "list_bib_entries",
      ).length;
      expect(after - before).toBe(1);
    });
  });

  it("copy citation failure shows an error status", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    setClipboardMock(writeText);

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    const rowTitle = screen
      .getAllByTestId("reference-entry-title")
      .find((el) => el.textContent === "The Saiva Age")!;
    await user.click(rowTitle);
    await user.click(screen.getByRole("button", { name: /Copy citation/i }));

    await waitFor(() =>
      expect(useStatusMessageStore.getState().message).toMatch(/Failed to copy/i),
    );
    expect(useStatusMessageStore.getState().variant).toBe("error");
  });

  it("renders 'Add' button in header when entries exist", async () => {
    const user = userEvent.setup();
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    await user.click(screen.getByLabelText("More actions"));
    const addBtn = screen.getByTestId("reference-library-add-btn");
    expect(addBtn).toBeInTheDocument();
  });

  it("renders 'Add' button in empty state", async () => {
    fixture = [];
    render(<ReferenceLibrary />);
    await waitFor(() =>
      expect(screen.getByText(/No references found/i)).toBeInTheDocument(),
    );
    const addBtn = screen.getByTestId("reference-library-add-btn");
    expect(addBtn).toBeInTheDocument();
  });

  it("clicking 'Add' opens the AddReferenceDialog", async () => {
    const user = userEvent.setup();
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByLabelText("More actions"));
    await user.click(screen.getByTestId("reference-library-add-btn"));
    expect(screen.getByTestId("add-reference-dialog")).toBeInTheDocument();
  });

  it("onSaved from dialog triggers re-fetch", async () => {
    const user = userEvent.setup();
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "lookup_doi") return {
        key: "new2025",
        authors: ["New, A."],
        title: "New Paper",
        year: "2025",
        entry_type: "article",
        line_number: 0,
        doi: "10.1000/new",
      };
      if (cmd === "save_bib_entry") {
        // Simulate backend emitting the event (as save_bib_entry does in production)
        emitMockEvent("lit:bib-items-changed", {});
        return [{ Saved: { key: "new2025" } }];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    // Open overflow menu, then dialog
    await user.click(screen.getByLabelText("More actions"));
    await user.click(screen.getByTestId("reference-library-add-btn"));
    expect(screen.getByTestId("add-reference-dialog")).toBeInTheDocument();

    // Do a DOI lookup and save
    const input = screen.getByTestId("add-reference-doi-input") as HTMLInputElement;
    await user.type(input, "10.1000/new");
    await act(async () => {
      fireEvent.click(screen.getByTestId("add-reference-lookup-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("add-reference-preview")).toBeInTheDocument();
    });

    // Save (no bib file selection needed)
    const beforeCount = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
    await act(async () => {
      fireEvent.click(screen.getByTestId("add-reference-save-btn"));
    });

    await waitFor(() => {
      const afterCount = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
      expect(afterCount).toBeGreaterThan(beforeCount);
    });
  });

  it("expanding an entry fetches citing pages and shows the count", async () => {
    const user = userEvent.setup();
    citingFixture = [
      makeCiting(),
      makeCiting({ source_id: "notes/b.md", source_title: "Note B", source_line: 9 }),
    ];
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));

    expect(
      await screen.findByRole("button", { name: /Cited by \(2\)/ }),
    ).toBeInTheDocument();
    const call = invokedCommands.find((c) => c.cmd === "get_citing_pages");
    expect(call).toBeTruthy();
    expect(call!.args).toEqual({ bibKey: "sanderson2009" });
  });

  it('shows "Not cited" when the entry has no citations', async () => {
    const user = userEvent.setup();
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));

    expect(await screen.findByText("Not cited")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cited by/ })).not.toBeInTheDocument();
  });

  it("cited-by list is collapsed by default and toggles", async () => {
    const user = userEvent.setup();
    citingFixture = [
      makeCiting(),
      makeCiting({ source_id: "notes/b.md", source_title: "Note B", source_line: 9 }),
    ];
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    await user.click(screen.getByText("The Saiva Age"));

    const toggle = await screen.findByRole("button", { name: /Cited by \(2\)/ });
    expect(screen.queryByText("Note A")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText("Note A")).toBeInTheDocument();
    expect(screen.getByText("Note B")).toBeInTheDocument();
    expect(screen.getByTestId("citing-context-0").textContent).toContain(
      "see [@sanderson2009]",
    );
    expect(screen.getByText(/line 4/)).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByText("Note A")).not.toBeInTheDocument();
  });

  it("clicking a citing page title navigates to the citation line", async () => {
    const user = userEvent.setup();
    const selectPageAtLine = vi.fn();
    useWorkspaceStore.setState({ selectPageAtLine });
    citingFixture = [makeCiting()];
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    await user.click(screen.getByText("The Saiva Age"));
    await user.click(await screen.findByRole("button", { name: /Cited by \(1\)/ }));

    await user.click(screen.getByText("Note A"));
    expect(selectPageAtLine).toHaveBeenCalledWith("notes/a.md", 4);

    await user.click(screen.getByTestId("citing-context-0"));
    expect(selectPageAtLine).toHaveBeenCalledTimes(2);
    expect(selectPageAtLine).toHaveBeenLastCalledWith("notes/a.md", 4);
  });

  it("citing pages fetch failure shows Not cited", async () => {
    const user = userEvent.setup();
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") throw new Error("graph not ready");
      throw new Error(`Unknown command: ${cmd}`);
    });
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));

    expect(await screen.findByText("Not cited")).toBeInTheDocument();
  });

  it("waits for graphReady before fetching citing pages", async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({ graphReady: false });
    citingFixture = [makeCiting()];
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));

    // Give any erroneous fetch a chance to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(invokedCommands.filter((c) => c.cmd === "get_citing_pages")).toHaveLength(0);
    expect(screen.queryByText(/Cited by|Not cited/)).not.toBeInTheDocument();

    act(() => {
      useWorkspaceStore.setState({ graphReady: true });
    });

    expect(
      await screen.findByRole("button", { name: /Cited by \(1\)/ }),
    ).toBeInTheDocument();
  });

  it("does not call getReferenceCounts when graphReady is false", async () => {
    useWorkspaceStore.setState({ graphReady: false });
    refCountsFixture = { sanderson2009: 3 };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    // Give any erroneous fetch a chance to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(invokedCommands.filter((c) => c.cmd === "get_reference_counts")).toHaveLength(0);

    act(() => {
      useWorkspaceStore.setState({ graphReady: true });
    });

    await waitFor(() =>
      expect(invokedCommands.filter((c) => c.cmd === "get_reference_counts").length).toBeGreaterThan(0),
    );
  });

  it("records a jump before navigating from a citing page", async () => {
    const user = userEvent.setup();
    const fakeEditorView = {
      state: {
        selection: { main: { head: 10 } },
        doc: { lineAt: () => ({ number: 3, from: 8 }) },
      },
    };
    useWorkspaceStore.setState({
      currentPagePath: "current.md",
      selectPageAtLine: vi.fn(),
    });
    setCurrentEditorView(fakeEditorView as never);
    const spy = vi.spyOn(globalJumpTracker, "recordJump");
    citingFixture = [makeCiting()];

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    await user.click(screen.getByText("The Saiva Age"));
    await user.click(await screen.findByRole("button", { name: /Cited by \(1\)/ }));

    await user.click(screen.getByText("Note A"));

    expect(spy).toHaveBeenCalledWith(
      { notePath: "current.md", line: 3, col: 2 },
      { notePath: "", line: 0, col: 0 },
    );
    spy.mockRestore();
    setCurrentEditorView(null);
  });

  it("refetches citing pages when lit:graph-updated fires", async () => {
    const user = userEvent.setup();
    citingFixture = [makeCiting()];
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    expect(
      await screen.findByRole("button", { name: /Cited by \(1\)/ }),
    ).toBeInTheDocument();

    citingFixture = [
      makeCiting(),
      makeCiting({ source_id: "notes/b.md", source_title: "Note B", source_line: 9 }),
    ];
    emitMockEvent("lit:graph-updated", {});

    expect(
      await screen.findByRole("button", { name: /Cited by \(2\)/ }),
    ).toBeInTheDocument();
  });

  it("stops listening for lit:graph-updated when CitedBySection unmounts (entry collapsed)", async () => {
    const user = userEvent.setup();
    citingFixture = [makeCiting()];
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    expect(
      await screen.findByRole("button", { name: /Cited by \(1\)/ }),
    ).toBeInTheDocument();

    const rowTitle = () =>
      screen
        .getAllByTestId("reference-entry-title")
        .find((el) => el.textContent === "The Saiva Age")!;
    await user.click(rowTitle());
    expect(screen.queryByRole("button", { name: /Cited by/ })).not.toBeInTheDocument();

    const countBefore = invokedCommands.filter((c) => c.cmd === "get_citing_pages").length;
    citingFixture = [
      makeCiting(),
      makeCiting({ source_id: "notes/b.md", source_title: "Note B", source_line: 9 }),
    ];
    emitMockEvent("lit:graph-updated", {});
    await new Promise((r) => setTimeout(r, 20));

    const countAfter = invokedCommands.filter((c) => c.cmd === "get_citing_pages").length;
    expect(countAfter).toBe(countBefore);
  });

  it("highlights [[wikilink]] in cited-by context text", async () => {
    const user = userEvent.setup();
    citingFixture = [makeCiting({ context: "See [[Topic]] and [@smith2024]" })];
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(await screen.findByRole("button", { name: /Cited by \(1\)/ }));

    const ctx = screen.getByTestId("citing-context-0");
    expect(ctx.innerHTML).toContain("text-interactive-accent");
    expect(ctx.textContent).toContain("[[Topic]]");
  });

  it("lit:graph-updated updates the expanded cited-by list items", async () => {
    const user = userEvent.setup();
    citingFixture = [makeCiting()];
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    const toggle = await screen.findByRole("button", { name: /Cited by \(1\)/ });
    await user.click(toggle);
    expect(screen.getByText("Note A")).toBeInTheDocument();

    citingFixture = [
      makeCiting(),
      makeCiting({ source_id: "notes/b.md", source_title: "Note B", source_line: 9 }),
    ];
    emitMockEvent("lit:graph-updated", {});

    expect(await screen.findByText("Note B")).toBeInTheDocument();
    expect(screen.getByText("Note A")).toBeInTheDocument();
  });

  it("shows enriched indicator for partial materialization entries", async () => {
    bibKeyStatesFixture = { sanderson2009: { materialization: "partial", page_id: null } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    expect(document.querySelector('[data-indicator="enriched"]')).toBeInTheDocument();
  });

  it("shows has-note indicator for citekey-linked entries", async () => {
    bibKeyStatesFixture = { sanderson2009: { materialization: "materialized", page_id: "notes/sanderson.md" } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    expect(document.querySelector('[data-indicator="has-note"]')).toBeInTheDocument();
  });

  it("no indicator for shadow materialization entries", async () => {
    bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    expect(document.querySelector('[data-indicator]')).not.toBeInTheDocument();
  });

  it("no indicator when bib key is absent from bibKeyStates", async () => {
    bibKeyStatesFixture = {};
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    expect(document.querySelector('[data-indicator]')).not.toBeInTheDocument();
  });

  it("has-note indicator prioritized over enriched when page_id is present", async () => {
    bibKeyStatesFixture = { sanderson2009: { materialization: "partial", page_id: "notes/sanderson.md" } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    expect(document.querySelector('[data-indicator="has-note"]')).toBeInTheDocument();
    expect(document.querySelector('[data-indicator="enriched"]')).not.toBeInTheDocument();
  });

  it("expanded card shows enriched indicator for partial entries", async () => {
    const user = userEvent.setup();
    bibKeyStatesFixture = { sanderson2009: { materialization: "partial", page_id: null } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));

    expect(document.querySelector('[data-indicator="enriched"]')).toBeInTheDocument();
  });

  it("clicking 'Has note' link in expanded card navigates to the linked page", async () => {
    const user = userEvent.setup();
    const selectPage = vi.fn();
    useWorkspaceStore.setState({ selectPage });
    bibKeyStatesFixture = { sanderson2009: { materialization: "materialized", page_id: "notes/sanderson.md" } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));

    const link = screen.getByTestId("has-note-link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("aria-label", "Open note");
    expect(link).toHaveAttribute("title", expect.stringContaining("notes/sanderson.md"));

    await user.click(link);
    expect(selectPage).toHaveBeenCalledWith("notes/sanderson.md");
  });

  it("refetches bib key states when lit:graph-updated fires", async () => {
    bibKeyStatesFixture = {};
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    expect(document.querySelector('[data-indicator]')).not.toBeInTheDocument();

    bibKeyStatesFixture = { sanderson2009: { materialization: "partial", page_id: null } };
    emitMockEvent("lit:graph-updated", {});

    await waitFor(() =>
      expect(document.querySelector('[data-indicator="enriched"]')).toBeInTheDocument(),
    );
  });

  it("refetches bib key states when a .bib file is modified", async () => {
    bibKeyStatesFixture = {};
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    expect(document.querySelector('[data-indicator]')).not.toBeInTheDocument();

    bibKeyStatesFixture = { sanderson2009: { materialization: "partial", page_id: null } };
    emitMockEvent("workspace://file-modified", { path: "refs.bib" });

    await waitFor(() =>
      expect(document.querySelector('[data-indicator="enriched"]')).toBeInTheDocument(),
    );
  });

  it("fetches bib key states on mount via get_bib_key_states", async () => {
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    const call = invokedCommands.find((c) => c.cmd === "get_bib_key_states");
    expect(call).toBeTruthy();
  });

  it("shows 'Create note' button in expanded card when state exists but page_id is null", async () => {
    const user = userEvent.setup();
    bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));

    const btn = screen.getByTestId("create-note-btn");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-label", "Create note");
  });

  it("shows 'Create note' button with enriched indicator for partial entries", async () => {
    const user = userEvent.setup();
    bibKeyStatesFixture = { sanderson2009: { materialization: "partial", page_id: null } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));

    expect(screen.getByTestId("create-note-btn")).toBeInTheDocument();
    expect(document.querySelector('[data-indicator="enriched"]')).toBeInTheDocument();
  });

  it("shows 'Open note' link in expanded card when state.page_id is set", async () => {
    const user = userEvent.setup();
    bibKeyStatesFixture = { sanderson2009: { materialization: "materialized", page_id: "notes/sanderson.md" } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));

    const link = screen.getByTestId("has-note-link");
    expect(link).toHaveAttribute("aria-label", "Open note");
    expect(link).toHaveAttribute("title", expect.stringContaining("notes/sanderson.md"));
  });

  it("clicking 'Create note' calls materializeCitation and navigates to the new page", async () => {
    const user = userEvent.setup();
    const selectPage = vi.fn();
    useWorkspaceStore.setState({ selectPage, pages: [] });
    bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };

    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "materialize_citation") return {
        title: "Sanderson (2009) The Saiva Age",
        relative_path: "notes/sanderson2009.md",
        frontmatter: { citekey: "sanderson2009" },
        created_at: 1000,
        modified_at: 2000,
        file_type: "markdown",
      };
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("create-note-btn"));

    await waitFor(() => {
      const call = invokedCommands.find((c) => c.cmd === "materialize_citation");
      expect(call).toBeTruthy();
      expect(call!.args).toEqual({ bibKey: "sanderson2009" });
    });
    await waitFor(() => {
      expect(selectPage).toHaveBeenCalledWith("notes/sanderson2009.md");
    });
    // The new page must appear in the workspace store's pages array
    const pages = useWorkspaceStore.getState().pages;
    expect(pages.some((p: { relative_path: string }) => p.relative_path === "notes/sanderson2009.md")).toBe(true);
  });

  it("clicking 'Create note' shows error status on failure", async () => {
    const user = userEvent.setup();
    bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };

    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "materialize_citation") throw new Error("disk full");
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("create-note-btn"));

    await waitFor(() =>
      expect(useStatusMessageStore.getState().message).toMatch(/disk full/i),
    );
    expect(useStatusMessageStore.getState().variant).toBe("error");
  });

  it("disables 'Create note' button while materialization is in flight", async () => {
    const user = userEvent.setup();
    bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };

    let resolveMaterialize!: (value: unknown) => void;
    const pending = new Promise((r) => { resolveMaterialize = r; });

    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "materialize_citation") return pending;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    const btn = screen.getByTestId("create-note-btn");
    expect(btn).not.toBeDisabled();

    await user.click(btn);

    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveAttribute("aria-label", "Creating…");

    // Resolve the pending call
    resolveMaterialize({
      title: "Sanderson (2009) The Saiva Age",
      relative_path: "notes/sanderson2009.md",
      frontmatter: { citekey: "sanderson2009" },
      created_at: 1000,
      modified_at: 2000,
      file_type: "markdown",
    });
  });

  it("does not fire a second materialize_citation on rapid double-click", async () => {
    const user = userEvent.setup();
    bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };

    let resolveMaterialize!: (value: unknown) => void;
    const pending = new Promise((r) => { resolveMaterialize = r; });

    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "materialize_citation") return pending;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    const btn = screen.getByTestId("create-note-btn");

    // Click twice rapidly
    await user.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    // Second click on a disabled button should be a no-op
    await user.click(btn);

    const materializeCalls = invokedCommands.filter((c) => c.cmd === "materialize_citation");
    expect(materializeCalls).toHaveLength(1);

    // Cleanup
    resolveMaterialize({
      title: "Sanderson (2009) The Saiva Age",
      relative_path: "notes/sanderson2009.md",
      frontmatter: { citekey: "sanderson2009" },
      created_at: 1000,
      modified_at: 2000,
      file_type: "markdown",
    });
  });

  it("re-enables 'Create note' button after materialization failure", async () => {
    const user = userEvent.setup();
    bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };

    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "materialize_citation") throw new Error("disk full");
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    const btn = screen.getByTestId("create-note-btn");

    await user.click(btn);

    // After failure, button should be re-enabled
    await waitFor(() => expect(btn).not.toBeDisabled());
    // And the error message should be shown
    expect(useStatusMessageStore.getState().message).toMatch(/disk full/i);
  });

  it("discards stale bib key states after rapid graph updates", async () => {
    // Start with no badges
    bibKeyStatesFixture = {};

    let bibStatesCallCount = 0;
    let resolveStale!: (value: Record<string, { materialization: string; page_id: string | null }>) => void;
    const deferredStale = new Promise<Record<string, { materialization: string; page_id: string | null }>>((r) => {
      resolveStale = r;
    });

    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") {
        bibStatesCallCount++;
        // First call (mount) returns empty — no badges
        if (bibStatesCallCount === 1) return {};
        // Second call (first graph-updated) returns a deferred promise (stale)
        if (bibStatesCallCount === 2) return deferredStale;
        // Third call (second graph-updated) returns fresh result immediately
        return { sanderson2009: { materialization: "partial", page_id: null } };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    // Fire two rapid graph-updated events
    emitMockEvent("lit:graph-updated", {});
    emitMockEvent("lit:graph-updated", {});

    // The third (fresh) call should resolve immediately, showing the enriched indicator
    await waitFor(() =>
      expect(document.querySelector('[data-indicator="enriched"]')).toBeInTheDocument(),
    );

    // Now resolve the stale (second) call with a result that would show "has-note"
    resolveStale({ sanderson2009: { materialization: "materialized", page_id: "notes/stale.md" } });

    // Wait a bit for any erroneous state update to propagate
    await new Promise((r) => setTimeout(r, 50));

    // The stale result should have been discarded — still showing enriched, not has-note
    expect(document.querySelector('[data-indicator="has-note"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-indicator="enriched"]')).toBeInTheDocument();
  });

  describe("Import PDF button", () => {
    it("renders 'Import PDF' button in header when entries exist", async () => {
      const user = userEvent.setup();
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
      await user.click(screen.getByLabelText("More actions"));
      const importBtn = screen.getByTestId("reference-library-import-pdf-btn");
      expect(importBtn).toBeInTheDocument();
    });

    it("renders 'Import PDF' button in empty state", async () => {
      fixture = [];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText(/No references found/i)).toBeInTheDocument(),
      );
      const importBtn = screen.getByTestId("reference-library-import-pdf-btn");
      expect(importBtn).toBeInTheDocument();
    });

    it("clicking 'Import PDF' opens the ImportPdfDialog", async () => {
      const user = userEvent.setup();
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByLabelText("More actions"));
      await user.click(screen.getByTestId("reference-library-import-pdf-btn"));
      expect(screen.getByTestId("import-pdf-dialog")).toBeInTheDocument();
    });

    it("onImported from ImportPdfDialog triggers re-fetch", async () => {
      const user = userEvent.setup();
      const resolvedResult = {
        kind: "resolved" as const,
        outcome: { Saved: { key: "newpdf2024" } },
        source: "DoiContentNegotiation" as const,
        validation: "validated" as const,
        file: "papers/newpdf2024.pdf",
        entry: {
          key: "newpdf2024",
          authors: ["New, A."],
          title: "New PDF Paper",
          year: "2024",
          entry_type: "article",
          line_number: 0,
        },
      };

      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "recognize_pdf") {
          // Simulate backend emitting the event (as recognize_pdf does in production)
          emitMockEvent("lit:bib-items-changed", {});
          return resolvedResult;
        }
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      // Open overflow menu, then dialog
      await user.click(screen.getByLabelText("More actions"));
      await user.click(screen.getByTestId("reference-library-import-pdf-btn"));
      expect(screen.getByTestId("import-pdf-dialog")).toBeInTheDocument();

      // Mock the file dialog to return a PDF path
      const { open } = await import("@tauri-apps/plugin-dialog");
      (open as ReturnType<typeof vi.fn>).mockResolvedValueOnce("/workspace/paper.pdf");

      const beforeCount = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;

      await act(async () => {
        fireEvent.click(screen.getByTestId("import-pdf-choose-btn"));
      });

      await waitFor(() => {
        const afterCount = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
        expect(afterCount).toBeGreaterThan(beforeCount);
      });
    });
  });

  describe("Fetch details button", () => {
    const enrichResult = {
      entry: { ...sanderson, abstract_text: "Enriched abstract" },
      fields_added: ["abstract", "journal"],
      references_found: 5,
      references_appended: 5,
      shadow_nodes_created: 3,
      references_linked: 5,
      candidates: [],
      providers_searched: [],
      providers_failed: [],
    };

    it("shows 'Fetch details' button for shadow materialization entries", async () => {
      const user = userEvent.setup();
      bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "enrich_bib_entry") return enrichResult;
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      const btn = screen.getByTestId("fetch-details-btn");
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveAttribute("aria-label", "Fetch details");
    });

    it("hides fetch-details button for partial materialization entries without page_id", async () => {
      const user = userEvent.setup();
      bibKeyStatesFixture = { sanderson2009: { materialization: "partial", page_id: null } };
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "enrich_bib_entry") return enrichResult;
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      expect(screen.queryByTestId("fetch-details-btn")).not.toBeInTheDocument();
    });

    it("hides button when page_id is set (materialized entry)", async () => {
      const user = userEvent.setup();
      bibKeyStatesFixture = { sanderson2009: { materialization: "materialized", page_id: "notes/sanderson.md" } };
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "enrich_bib_entry") return enrichResult;
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      expect(screen.queryByTestId("fetch-details-btn")).not.toBeInTheDocument();
    });

    it("hides button when page_id is set even if partial", async () => {
      const user = userEvent.setup();
      bibKeyStatesFixture = { sanderson2009: { materialization: "partial", page_id: "notes/sanderson.md" } };
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "enrich_bib_entry") return enrichResult;
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      expect(screen.queryByTestId("fetch-details-btn")).not.toBeInTheDocument();
    });

    it("shows 'Fetch details' button when entry has no bibKeyState at all", async () => {
      const user = userEvent.setup();
      bibKeyStatesFixture = {};
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "enrich_bib_entry") return enrichResult;
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      const btn = screen.getByTestId("fetch-details-btn");
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveAttribute("aria-label", "Fetch details");
    });

    it("clicking 'Fetch details' calls enrich_bib_entry with correct args", async () => {
      const user = userEvent.setup();
      bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "enrich_bib_entry") return enrichResult;
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("fetch-details-btn"));

      await waitFor(() => {
        const call = invokedCommands.find((c) => c.cmd === "enrich_bib_entry");
        expect(call).toBeTruthy();
        expect(call!.args).toEqual({ bibKey: "sanderson2009", workspacePath: "/workspace" });
      });
    });

    it("successful enrichment re-fetches entries and bib key states", async () => {
      const user = userEvent.setup();
      bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "enrich_bib_entry") {
          // Simulate backend emitting the event (as enrich_bib_entry does in production)
          emitMockEvent("lit:bib-items-changed", {});
          return enrichResult;
        }
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      const entriesBefore = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
      const statesBefore = invokedCommands.filter((c) => c.cmd === "get_bib_key_states").length;

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("fetch-details-btn"));

      await waitFor(() => {
        const entriesAfter = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
        expect(entriesAfter).toBeGreaterThan(entriesBefore);
      });
      await waitFor(() => {
        const statesAfter = invokedCommands.filter((c) => c.cmd === "get_bib_key_states").length;
        expect(statesAfter).toBeGreaterThan(statesBefore);
      });
    });

    it("successful enrichment shows success toast", async () => {
      const user = userEvent.setup();
      bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "enrich_bib_entry") return enrichResult;
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("fetch-details-btn"));

      await waitFor(() => {
        const msg = useStatusMessageStore.getState().message;
        expect(msg).toMatch(/sanderson2009/);
        expect(msg).toMatch(/abstract/);
        expect(msg).toContain("references added");
      });
    });

    it("enrichment error shows error toast", async () => {
      const user = userEvent.setup();
      bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "enrich_bib_entry") throw new Error("Network timeout");
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("fetch-details-btn"));

      await waitFor(() => {
        expect(useStatusMessageStore.getState().variant).toBe("error");
      });
    });

    it("toast shows capped reference count when references are truncated", async () => {
      const user = userEvent.setup();
      bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };
      const cappedResult = {
        ...enrichResult,
        references_found: 150,
        references_appended: 30,
        shadow_nodes_created: 25,
      };
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "enrich_bib_entry") return cappedResult;
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("fetch-details-btn"));

      await waitFor(() => {
        const msg = useStatusMessageStore.getState().message;
        expect(msg).toContain("30 of 150 references added");
      });
    });

    it("toast shows uncapped reference count without qualifier", async () => {
      const user = userEvent.setup();
      bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };
      const uncappedResult = {
        ...enrichResult,
        references_found: 5,
        references_appended: 5,
        shadow_nodes_created: 3,
      };
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "enrich_bib_entry") return uncappedResult;
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("fetch-details-btn"));

      await waitFor(() => {
        const msg = useStatusMessageStore.getState().message;
        expect(msg).toContain("5 references added");
        expect(msg).not.toContain("of 5");
      });
    });

    it("button shows loading state while enriching", async () => {
      const user = userEvent.setup();
      bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };
      let resolveEnrich!: (value: typeof enrichResult) => void;
      const deferredEnrich = new Promise<typeof enrichResult>((r) => {
        resolveEnrich = r;
      });
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "enrich_bib_entry") return deferredEnrich;
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("fetch-details-btn"));

      await waitFor(() => {
        const btn = screen.getByTestId("fetch-details-btn");
        expect(btn).toBeDisabled();
        expect(btn).toHaveAttribute("aria-label", expect.stringMatching(/Fetching/i));
      });

      await act(async () => {
        resolveEnrich(enrichResult);
      });

      await waitFor(() => {
        const btn = screen.getByTestId("fetch-details-btn");
        expect(btn).not.toBeDisabled();
        expect(btn).toHaveAttribute("aria-label", "Fetch details");
      });
    });
  });

  it("reloads entries when lit:bib-items-changed event fires", async () => {
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    const before = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
    fixture = [{ ...sanderson, title: "The Saiva Age (updated)" }, flood, abrams];
    emitMockEvent("lit:bib-items-changed", {});

    await waitFor(() =>
      expect(screen.getByText("The Saiva Age (updated)")).toBeInTheDocument(),
    );
    const after = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
    expect(after).toBeGreaterThan(before);
  });

  it("loads entries after graph becomes ready via lit:graph-updated when initial mount fails", async () => {
    let listCallCount = 0;
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") {
        listCallCount++;
        if (listCallCount === 1) throw new Error("Graph index not ready");
        return fixture;
      }
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() =>
      expect(screen.getByText(/No references found/i)).toBeInTheDocument(),
    );

    emitMockEvent("lit:graph-updated", {});

    await waitFor(() =>
      expect(screen.getByText("The Saiva Age")).toBeInTheDocument(),
    );
  });

  it("lit:graph-updated re-fetches both entries and bib key states", async () => {
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    const entriesBefore = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
    const statesBefore = invokedCommands.filter((c) => c.cmd === "get_bib_key_states").length;

    emitMockEvent("lit:graph-updated", {});

    await waitFor(() => {
      const entriesAfter = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
      expect(entriesAfter).toBeGreaterThan(entriesBefore);
    });
    await waitFor(() => {
      const statesAfter = invokedCommands.filter((c) => c.cmd === "get_bib_key_states").length;
      expect(statesAfter).toBeGreaterThan(statesBefore);
    });
  });

  it("lit:graph-updated re-fetches reference counts too", async () => {
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    const countsBefore = invokedCommands.filter((c) => c.cmd === "get_reference_counts").length;

    emitMockEvent("lit:graph-updated", {});

    await waitFor(() => {
      const countsAfter = invokedCommands.filter((c) => c.cmd === "get_reference_counts").length;
      expect(countsAfter).toBeGreaterThan(countsBefore);
    });
  });

  it("lit:bib-items-changed re-fetches entries, bib key states, and reference counts", async () => {
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    const entriesBefore = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
    const statesBefore = invokedCommands.filter((c) => c.cmd === "get_bib_key_states").length;
    const countsBefore = invokedCommands.filter((c) => c.cmd === "get_reference_counts").length;

    emitMockEvent("lit:bib-items-changed", {});

    await waitFor(() => {
      const entriesAfter = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
      expect(entriesAfter).toBeGreaterThan(entriesBefore);
    });
    await waitFor(() => {
      const statesAfter = invokedCommands.filter((c) => c.cmd === "get_bib_key_states").length;
      expect(statesAfter).toBeGreaterThan(statesBefore);
    });
    await waitFor(() => {
      const countsAfter = invokedCommands.filter((c) => c.cmd === "get_reference_counts").length;
      expect(countsAfter).toBeGreaterThan(countsBefore);
    });
  });

  describe("Drag-drop", () => {
    /** Mock the panel's bounding rect so checkHit succeeds for drops at (50,50). */
    function mockPanelHitArea() {
      const panel = screen.getByTestId("reference-library-panel");
      vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 1000));
      Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
    }

    it("subscribes to onDragDropEvent on mount when workspace is set", async () => {
      const { mockOnDragDropFn } = mockOnDragDropEvent();
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      expect(mockOnDragDropFn).toHaveBeenCalled();
    });

    it("unsubscribes from onDragDropEvent on unmount", async () => {
      const { mockUnlisten } = mockOnDragDropEvent();
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        throw new Error(`Unknown command: ${cmd}`);
      });

      const { unmount } = render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      unmount();
      // Allow async unlisten to resolve
      await new Promise((r) => setTimeout(r, 10));
      expect(mockUnlisten).toHaveBeenCalled();
    });

    it("dropping a single .pdf opens ImportPdfDialog in progress state", async () => {
      mockOnDragDropEvent();
      const resolvedResult = {
        kind: "resolved" as const,
        outcome: { Saved: { key: "dropped2024" } },
        source: "DoiContentNegotiation" as const,
        validation: "validated" as const,
        file: "papers/dropped2024.pdf",
        entry: {
          key: "dropped2024",
          authors: ["Drop, D."],
          title: "Dropped PDF",
          year: "2024",
          entry_type: "article",
          line_number: 0,
        },
      };

      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;

        if (cmd === "recognize_pdf") return resolvedResult;
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
      mockPanelHitArea();

      act(() => {
        emitDragDropEvent({
          type: "drop",
          paths: ["/path/to/paper.pdf"],
          position: { x: 50, y: 50 },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("import-pdf-dialog")).toBeInTheDocument();
      });

      // Verify recognize_pdf was called with the dropped path
      await waitFor(() => {
        const call = invokedCommands.find((c) => c.cmd === "recognize_pdf");
        expect(call).toBeTruthy();
        expect((call!.args as Record<string, unknown>).pdfPath).toBe("/path/to/paper.pdf");
      });
    });

    it("dropping non-PDF files shows toast and does not open dialog", async () => {
      mockOnDragDropEvent();
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
      mockPanelHitArea();

      act(() => {
        emitDragDropEvent({
          type: "drop",
          paths: ["/path/to/file.docx"],
          position: { x: 50, y: 50 },
        });
      });

      await waitFor(() => {
        expect(useStatusMessageStore.getState().message).toBe(
          "Only PDF files can be imported",
        );
      });
      expect(screen.queryByTestId("import-pdf-dialog")).not.toBeInTheDocument();
    });

    it("dropping multiple PDFs imports first and shows multi-import toast", async () => {
      mockOnDragDropEvent();
      const toastMessages: string[] = [];
      const origShow = useStatusMessageStore.getState().show;
      useStatusMessageStore.setState({
        show: (message: string, variant?: "success" | "error" | "progress") => {
          toastMessages.push(message);
          origShow(message, variant);
        },
      });

      let recognizeDeferred: { resolve: (v: unknown) => void } | null = null;
      const recognizePromise = new Promise((resolve) => {
        recognizeDeferred = { resolve };
      });

      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;

        if (cmd === "recognize_pdf") return recognizePromise;
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
      mockPanelHitArea();

      act(() => {
        emitDragDropEvent({
          type: "drop",
          paths: ["/a.pdf", "/b.pdf"],
          position: { x: 50, y: 50 },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("import-pdf-dialog")).toBeInTheDocument();
      });

      // The multi-import toast should have been shown (even if later overwritten by "Recognizing PDF...")
      expect(toastMessages.some((m) => m.includes("multi-import is not yet supported"))).toBe(true);

      // Cleanup
      recognizeDeferred!.resolve({
        kind: "resolved",
        outcome: { Saved: { key: "a2024" } },
        source: "DoiContentNegotiation",
        validation: "validated",
        file: "papers/a.pdf",
        entry: { key: "a2024", authors: [], title: "", year: "", entry_type: "article", line_number: 0 },
      });
    });

    it("dropping mix of PDF and non-PDF filters to only PDFs", async () => {
      mockOnDragDropEvent();
      let recognizeDeferred: { resolve: (v: unknown) => void } | null = null;
      const recognizePromise = new Promise((resolve) => {
        recognizeDeferred = { resolve };
      });

      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;

        if (cmd === "recognize_pdf") return recognizePromise;
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
      mockPanelHitArea();

      act(() => {
        emitDragDropEvent({
          type: "drop",
          paths: ["/a.txt", "/b.pdf"],
          position: { x: 50, y: 50 },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("import-pdf-dialog")).toBeInTheDocument();
      });

      // Should call recognize_pdf with the PDF path
      await waitFor(() => {
        const call = invokedCommands.find((c) => c.cmd === "recognize_pdf");
        expect(call).toBeTruthy();
        expect((call!.args as Record<string, unknown>).pdfPath).toBe("/b.pdf");
      });

      // Cleanup
      recognizeDeferred!.resolve({
        kind: "resolved",
        outcome: { Saved: { key: "b2024" } },
        source: "DoiContentNegotiation",
        validation: "validated",
        file: "papers/b.pdf",
        entry: { key: "b2024", authors: [], title: "", year: "", entry_type: "article", line_number: 0 },
      });
    });

    it("drop outside panel bounding rect does not open ImportPdfDialog", async () => {
      mockOnDragDropEvent();
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      // Mock the panel rect to occupy x:100-300, y:100-400
      const panel = screen.getByTestId("reference-library-panel");
      vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 200, 300));
      Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });

      // Drop at (50,50) -- outside the panel rect
      act(() => {
        emitDragDropEvent({
          type: "drop",
          paths: ["/path/to/paper.pdf"],
          position: { x: 50, y: 50 },
        });
      });

      // Wait a tick to ensure any state updates would have happened
      await new Promise((r) => setTimeout(r, 50));

      // Dialog must NOT open
      expect(screen.queryByTestId("import-pdf-dialog")).not.toBeInTheDocument();
      // No recognize_pdf command should have been invoked
      expect(invokedCommands.find((c) => c.cmd === "recognize_pdf")).toBeUndefined();
      // No error toast for off-panel drops
      expect(useStatusMessageStore.getState().message).not.toBe(
        "Only PDF files can be imported",
      );
    });

    it("does not subscribe when workspacePath is null", async () => {
      const { mockOnDragDropFn } = mockOnDragDropEvent();
      useWorkspaceStore.setState({ workspacePath: null });
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return [];
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText(/No references found/i)).toBeInTheDocument(),
      );

      expect(mockOnDragDropFn).not.toHaveBeenCalled();
    });

    it("re-dropping the same PDF file reopens the import dialog", async () => {
      mockOnDragDropEvent();
      const resolvedResult = {
        kind: "resolved" as const,
        outcome: { Saved: { key: "same2024" } },
        source: "DoiContentNegotiation" as const,
        validation: "validated" as const,
        file: "papers/same2024.pdf",
        entry: {
          key: "same2024",
          authors: ["Same, S."],
          title: "Same PDF",
          year: "2024",
          entry_type: "article",
          line_number: 0,
        },
      };

      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;

        if (cmd === "recognize_pdf") return resolvedResult;
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
      mockPanelHitArea();

      // First drop
      act(() => {
        emitDragDropEvent({
          type: "drop",
          paths: ["/same/paper.pdf"],
          position: { x: 50, y: 50 },
        });
      });

      // Dialog opens
      await waitFor(() => {
        expect(screen.getByTestId("import-pdf-dialog")).toBeInTheDocument();
      });

      // recognize_pdf resolves with Saved => onImported fires => dialog closes
      await waitFor(() => {
        expect(screen.queryByTestId("import-pdf-dialog")).not.toBeInTheDocument();
      });

      // Second drop of the SAME path
      act(() => {
        emitDragDropEvent({
          type: "drop",
          paths: ["/same/paper.pdf"],
          position: { x: 50, y: 50 },
        });
      });

      // Dialog must reopen
      await waitFor(() => {
        expect(screen.getByTestId("import-pdf-dialog")).toBeInTheDocument();
      });

      // recognize_pdf was called twice, both times with the same path
      const recognizeCalls = invokedCommands.filter((c) => c.cmd === "recognize_pdf");
      expect(recognizeCalls).toHaveLength(2);
      expect((recognizeCalls[0]!.args as Record<string, unknown>).pdfPath).toBe("/same/paper.pdf");
      expect((recognizeCalls[1]!.args as Record<string, unknown>).pdfPath).toBe("/same/paper.pdf");
    });
  });

  describe("Download PDF button", () => {
    const sandersonWithDoi: BibEntry = {
      ...sanderson,
      doi: "10.1000/xyz",
      file: undefined,
    };

    const sandersonWithArxiv: BibEntry = {
      ...sanderson,
      doi: undefined,
      arxiv_id: "2301.12345",
      file: undefined,
    };

    const sandersonWithFile: BibEntry = {
      ...sanderson,
      doi: "10.1000/xyz",
      file: "assets/pdf/sanderson2009.pdf",
    };

    const sandersonNoIds: BibEntry = {
      ...sanderson,
      doi: undefined,
      arxiv_id: undefined,
      file: undefined,
    };

    function setupMockWithDownload(
      fixtureOverride: BibEntry[],
      downloadHandler?: (cmd: string, args: unknown) => unknown,
    ) {
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixtureOverride;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "download_entry_pdf") {
          if (downloadHandler) return downloadHandler(cmd, args as unknown);
          return "assets/pdf/sanderson2009.pdf";
        }
        throw new Error(`Unknown command: ${cmd}`);
      });
    }

    it("shows 'Download PDF' button for entry with DOI but no file", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithDoi];
      setupMockWithDownload(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      expect(screen.getByTestId("download-pdf-btn")).toBeInTheDocument();
      expect(screen.getByTestId("download-pdf-btn")).toHaveAttribute("aria-label", "Download PDF");
    });

    it("shows 'Download PDF' button for entry with arxiv_id but no file", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithArxiv];
      setupMockWithDownload(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      expect(screen.getByTestId("download-pdf-btn")).toBeInTheDocument();
    });

    it("shows 'Open PDF' instead of 'Download PDF' when entry has file", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      setupMockWithDownload(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      expect(screen.getByTestId("open-pdf-btn")).toBeInTheDocument();
      expect(screen.queryByTestId("download-pdf-btn")).not.toBeInTheDocument();
    });

    it("shows neither button when entry has no DOI, no arxiv_id, and no file", async () => {
      const user = userEvent.setup();
      fixture = [sandersonNoIds];
      setupMockWithDownload(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      expect(screen.queryByTestId("download-pdf-btn")).not.toBeInTheDocument();
      expect(screen.queryByTestId("open-pdf-btn")).not.toBeInTheDocument();
    });

    it("clicking 'Download PDF' calls download_entry_pdf with correct args", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithDoi];
      setupMockWithDownload(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("download-pdf-btn"));

      await waitFor(() => {
        const call = invokedCommands.find((c) => c.cmd === "download_entry_pdf");
        expect(call).toBeTruthy();
        expect(call!.args).toEqual({ key: "sanderson2009", workspacePath: "/workspace" });
      });
    });

    it("shows 'Resolving...' while download is in flight", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithDoi];
      let resolveDownload!: (value: string) => void;
      const pending = new Promise<string>((r) => { resolveDownload = r; });
      setupMockWithDownload(fixture, () => pending);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("download-pdf-btn"));

      await waitFor(() => {
        const btn = screen.getByTestId("download-pdf-btn");
        expect(btn).toBeDisabled();
        expect(btn).toHaveAttribute("aria-label", "Resolving…");
      });

      await act(async () => { resolveDownload("assets/pdf/sanderson2009.pdf"); });
    });

    it("successful download shows success toast", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithDoi];
      setupMockWithDownload(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("download-pdf-btn"));

      await waitFor(() => {
        const msg = useStatusMessageStore.getState().message;
        expect(msg).toMatch(/Downloaded PDF for @sanderson2009/);
      });
    });

    it("download error shows error toast", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithDoi];
      setupMockWithDownload(fixture, () => { throw new Error("No open-access PDF found"); });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("download-pdf-btn"));

      await waitFor(() => {
        expect(useStatusMessageStore.getState().message).toMatch(/No open-access PDF found/);
        expect(useStatusMessageStore.getState().variant).toBe("error");
      });
    });

    it("button re-enables after download completes", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithDoi];
      let resolveDownload!: (value: string) => void;
      const pending = new Promise<string>((r) => { resolveDownload = r; });
      setupMockWithDownload(fixture, () => pending);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("download-pdf-btn"));

      await waitFor(() => expect(screen.getByTestId("download-pdf-btn")).toBeDisabled());

      await act(async () => { resolveDownload("assets/pdf/sanderson2009.pdf"); });

      await waitFor(() => {
        const btn = screen.getByTestId("download-pdf-btn");
        expect(btn).not.toBeDisabled();
        expect(btn).toHaveAttribute("aria-label", "Download PDF");
      });
    });

    it("button re-enables after download error", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithDoi];
      setupMockWithDownload(fixture, () => { throw new Error("fail"); });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("download-pdf-btn"));

      await waitFor(() => {
        const btn = screen.getByTestId("download-pdf-btn");
        expect(btn).not.toBeDisabled();
        expect(btn).toHaveAttribute("aria-label", "Download PDF");
      });
    });

    it("clicking 'Open PDF' calls selectPage with the file path", async () => {
      const user = userEvent.setup();
      const selectPage = vi.fn();
      useWorkspaceStore.setState({ selectPage });
      fixture = [sandersonWithFile];
      setupMockWithDownload(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("open-pdf-btn"));

      expect(selectPage).toHaveBeenCalledWith("assets/pdf/sanderson2009.pdf");
    });

    it("updates button text with progress percentage when progress event fires", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithDoi];
      let resolveDownload!: (value: string) => void;
      const pending = new Promise<string>((r) => { resolveDownload = r; });
      setupMockWithDownload(fixture, () => pending);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("download-pdf-btn"));

      await waitFor(() => expect(screen.getByTestId("download-pdf-btn")).toBeDisabled());

      act(() => {
        emitMockEvent("lit:pdf-download-progress", {
          key: "sanderson2009",
          bytes_downloaded: 50000,
          bytes_total: 100000,
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("download-pdf-btn")).toHaveAttribute("aria-label", "Downloading 50%");
      });

      await act(async () => { resolveDownload("assets/pdf/sanderson2009.pdf"); });
    });

    it("shows indeterminate progress when total is null", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithDoi];
      let resolveDownload!: (value: string) => void;
      const pending = new Promise<string>((r) => { resolveDownload = r; });
      setupMockWithDownload(fixture, () => pending);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("download-pdf-btn"));

      await waitFor(() => expect(screen.getByTestId("download-pdf-btn")).toBeDisabled());

      act(() => {
        emitMockEvent("lit:pdf-download-progress", {
          key: "sanderson2009",
          bytes_downloaded: 50000,
          bytes_total: null,
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("download-pdf-btn")).toHaveAttribute("aria-label", "Downloading…");
      });

      await act(async () => { resolveDownload("assets/pdf/sanderson2009.pdf"); });
    });

    it("ignores progress events for a different key", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithDoi];
      let resolveDownload!: (value: string) => void;
      const pending = new Promise<string>((r) => { resolveDownload = r; });
      setupMockWithDownload(fixture, () => pending);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("download-pdf-btn"));

      await waitFor(() => expect(screen.getByTestId("download-pdf-btn")).toBeDisabled());

      act(() => {
        emitMockEvent("lit:pdf-download-progress", {
          key: "otherkey2020",
          bytes_downloaded: 50000,
          bytes_total: 100000,
        });
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(screen.getByTestId("download-pdf-btn")).toHaveAttribute("aria-label", "Resolving…");

      await act(async () => { resolveDownload("assets/pdf/sanderson2009.pdf"); });
    });
  });

  describe("OCR to Markdown button", () => {
    const sandersonWithFile: BibEntry = {
      ...sanderson,
      doi: "10.1000/xyz",
      file: "assets/pdf/sanderson2009.pdf",
    };

    const sandersonNoFile: BibEntry = {
      ...sanderson,
      doi: "10.1000/xyz",
      file: undefined,
    };

    function setupMockWithOcr(
      fixtureOverride: BibEntry[],
      handlers?: {
        checkOcrTargetExists?: (cmd: string, args: unknown) => unknown;
        ocrPdfToMarkdown?: (cmd: string, args: unknown) => unknown;
        isOcrCompanionCurrent?: (cmd: string, args: unknown) => unknown;
      },
    ) {
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixtureOverride;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "check_ocr_target_exists") {
          if (handlers?.checkOcrTargetExists) return handlers.checkOcrTargetExists(cmd, args as unknown);
          return false;
        }
        if (cmd === "is_ocr_companion_current") {
          if (handlers?.isOcrCompanionCurrent) return handlers.isOcrCompanionCurrent(cmd, args as unknown);
          return null;
        }
        if (cmd === "ocr_pdf_to_markdown") {
          if (handlers?.ocrPdfToMarkdown) return handlers.ocrPdfToMarkdown(cmd, args as unknown);
          return "ocr/sanderson2009.md";
        }
        if (cmd === "link_entry_pdf") return null;
        throw new Error(`Unknown command: ${cmd}`);
      });
    }

    it("shows 'OCR to Markdown' button when entry has file", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      setupMockWithOcr(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      expect(screen.getByTestId("ocr-btn")).toBeInTheDocument();
      expect(screen.getByTestId("ocr-btn")).toHaveAttribute("aria-label", "OCR to Markdown");
    });

    it("hides OCR button when entry has no file", async () => {
      const user = userEvent.setup();
      fixture = [sandersonNoFile];
      setupMockWithOcr(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      expect(screen.queryByTestId("ocr-btn")).not.toBeInTheDocument();
    });

    it("clicking OCR button opens OcrDialog", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      setupMockWithOcr(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("ocr-btn"));

      await waitFor(() => expect(screen.getByTestId("ocr-dialog")).toBeInTheDocument());
      expect(screen.getByTestId("ocr-start-btn")).toBeInTheDocument();
      expect(screen.getByTestId("ocr-entry-info")).toHaveTextContent("The Saiva Age");
    });

    it("successful OCR shows success toast", async () => {
      const user = userEvent.setup();
      const selectPage = vi.fn();
      useWorkspaceStore.setState({ selectPage });
      fixture = [sandersonWithFile];
      setupMockWithOcr(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("ocr-btn"));
      await waitFor(() => expect(screen.getByTestId("ocr-dialog")).toBeInTheDocument());
      await user.click(screen.getByTestId("ocr-start-btn"));

      await waitFor(() => {
        expect(useStatusMessageStore.getState().message).toMatch(/OCR complete for @sanderson2009/);
      });
      expect(screen.queryByTestId("ocr-dialog")).not.toBeInTheDocument();
      expect(selectPage).toHaveBeenCalledWith("ocr/sanderson2009.md");
    });

    it("successful OCR calls refreshPages so the sidebar updates", async () => {
      const user = userEvent.setup();
      const refreshPages = vi.fn();
      const selectPage = vi.fn();
      useWorkspaceStore.setState({ selectPage, refreshPages });
      fixture = [sandersonWithFile];
      setupMockWithOcr(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("ocr-btn"));
      await waitFor(() => expect(screen.getByTestId("ocr-dialog")).toBeInTheDocument());
      await user.click(screen.getByTestId("ocr-start-btn"));

      await waitFor(() => {
        expect(refreshPages).toHaveBeenCalled();
      });
      expect(selectPage).toHaveBeenCalledWith("ocr/sanderson2009.md");
    });

    it("OCR error shows error in dialog", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      setupMockWithOcr(fixture, {
        ocrPdfToMarkdown: () => { throw new Error("OCR engine not found"); },
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("ocr-btn"));
      await waitFor(() => expect(screen.getByTestId("ocr-dialog")).toBeInTheDocument());
      await user.click(screen.getByTestId("ocr-start-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("ocr-error")).toHaveTextContent("OCR engine not found");
      });
      expect(screen.getByTestId("ocr-dialog")).toBeInTheDocument();
    });

    it("hides OCR button when OCR companion markdown is current", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      setupMockWithOcr(fixture, {
        isOcrCompanionCurrent: () => "the-saiva-age.md",
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      await waitFor(() => {
        expect(screen.queryByTestId("ocr-btn")).not.toBeInTheDocument();
      });
    });

    it("shows OCR button when OCR companion markdown is not current", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      setupMockWithOcr(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      await waitFor(() => {
        expect(screen.getByTestId("ocr-btn")).toBeInTheDocument();
      });
    });

    it("does not collide ocrCompanionCurrentMap for entries with same citekey in different bib files", async () => {
      const user = userEvent.setup();
      const entryA: BibEntry = {
        ...sanderson,
        key: "sanderson2009",
        bib_file: "/workspace/refs.bib",
        file: "assets/pdf/sanderson2009.pdf",
      };
      const entryB: BibEntry = {
        ...sanderson,
        key: "sanderson2009",
        bib_file: "/workspace/other.bib",
        file: "assets/pdf/sanderson2009-other.pdf",
      };
      fixture = [entryA, entryB];
      // isOcrCompanionCurrent returns true for entry A's file, but defers
      // entry B's response so the stale map value from A is read during render
      let resolveBCheck: ((v: string | null) => void) | null = null;
      setupMockWithOcr(fixture, {
        isOcrCompanionCurrent: (_cmd, args) => {
          const a = args as { pdfRelative: string };
          if (a.pdfRelative === "assets/pdf/sanderson2009.pdf") return "the-saiva-age.md";
          // For entry B, return a promise that we control
          return new Promise<string | null>((resolve) => { resolveBCheck = resolve; });
        },
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getAllByText("The Saiva Age").length).toBe(2));

      const titles = screen.getAllByText("The Saiva Age");
      const titleA = titles[0]!;
      const titleB = titles[1]!;

      // Expand first entry (refs.bib) — companion IS current, OCR button hidden
      await user.click(titleA);
      await waitFor(() => {
        expect(screen.queryByTestId("ocr-btn")).not.toBeInTheDocument();
      });

      // Collapse first entry
      await user.click(titleA);

      // Expand second entry (other.bib) — before the async check resolves,
      // the map still has the value from entry A under the shared bare key.
      // With the bug, entry B reads map["sanderson2009"] = true -> button hidden.
      await user.click(titleB);

      // The check for B hasn't resolved yet. The render should NOT use A's cached value.
      // With the bug (bare key), ocrCompanionCurrentMap["sanderson2009"] is true (from A),
      // so the button is incorrectly hidden before B's check resolves.
      // With the fix (composite key), ocrCompanionCurrentMap for B's composite key is undefined,
      // so the button is shown (undefined != true).
      expect(screen.getByTestId("ocr-btn")).toBeInTheDocument();

      // Now resolve B's check as false
      await act(async () => { resolveBCheck!(null); });
      // Button should still be visible
      expect(screen.getByTestId("ocr-btn")).toBeInTheDocument();
    });

    it("re-shows OCR button after PDF re-link invalidates companion check", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      let companionCurrentResult: string | null = "the-saiva-age.md";
      setupMockWithOcr(fixture, {
        isOcrCompanionCurrent: () => companionCurrentResult,
      });
      mockDialogOpen("/new/path/to/file.pdf");
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      // Expand the entry — OCR button should be hidden (companion is current)
      await user.click(screen.getByText("The Saiva Age"));
      await waitFor(() => {
        expect(screen.queryByTestId("ocr-btn")).not.toBeInTheDocument();
      });

      // Now simulate re-link: after link succeeds the map entry is deleted
      // so prop becomes undefined -> button reappears
      companionCurrentResult = null;
      await user.click(screen.getByTestId("link-pdf-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("ocr-btn")).toBeInTheDocument();
      });
    });

    it("clears stale true when is_ocr_companion_current rejects after a prior success", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      let callCount = 0;
      setupMockWithOcr(fixture, {
        isOcrCompanionCurrent: () => {
          callCount++;
          if (callCount === 1) return "the-saiva-age.md";
          throw new Error("file not found");
        },
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      // Expand the entry — first check returns true, so OCR button is hidden
      await user.click(screen.getByTestId("reference-entry-title"));
      await waitFor(() => {
        expect(screen.queryByTestId("ocr-btn")).not.toBeInTheDocument();
      });

      // Collapse the entry
      await user.click(screen.getByTestId("reference-entry-title"));

      // Re-expand the entry — second check rejects, stale true should be cleared
      await user.click(screen.getByTestId("reference-entry-title"));
      await waitFor(() => {
        expect(screen.getByTestId("ocr-btn")).toBeInTheDocument();
      });
    });

    it("discards in-flight companion check result after entry collapse", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      let resolveFirst: ((v: string | null) => void) | null = null;
      let resolveSecond: ((v: string | null) => void) | null = null;
      let callCount = 0;
      setupMockWithOcr(fixture, {
        isOcrCompanionCurrent: () => {
          callCount++;
          if (callCount === 1) {
            return new Promise<string | null>((resolve) => { resolveFirst = resolve; });
          }
          return new Promise<string | null>((resolve) => { resolveSecond = resolve; });
        },
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      // Expand the entry — IPC call is in-flight (deferred promise)
      await user.click(screen.getByTestId("reference-entry-title"));
      expect(callCount).toBe(1);

      // Collapse the entry before IPC resolves
      await user.click(screen.getByTestId("reference-entry-title"));

      // The first IPC resolves with true AFTER collapse — should be discarded
      await act(async () => { resolveFirst!("the-saiva-age.md"); });

      // Re-expand the entry — triggers a fresh check
      await user.click(screen.getByTestId("reference-entry-title"));
      expect(callCount).toBe(2);

      // Before the second IPC resolves, the OCR button should be visible.
      // BUG: without cleanup, the stale first result (true) was written to the map
      // during collapse, so re-expand immediately sees ocrCompanionCurrent=true
      // and hides the button even though that result is stale.
      expect(screen.getByTestId("ocr-btn")).toBeInTheDocument();

      // Resolve the second (fresh) IPC with false — button remains visible
      await act(async () => { resolveSecond!(null); });
      expect(screen.getByTestId("ocr-btn")).toBeInTheDocument();
    });

    it("does not re-issue is_ocr_companion_current IPC when entries reload but expanded entry file is unchanged", async () => {
      const user = userEvent.setup();
      let companionCallCount = 0;
      // Return a fresh array each time (mimics real IPC deserialization)
      // but with the same entry content
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return [{ ...sandersonWithFile }];
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "is_ocr_companion_current") {
          companionCallCount++;
          return null;
        }
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      // Expand the entry — triggers the first companion check
      await user.click(screen.getByText("The Saiva Age"));
      await waitFor(() => expect(companionCallCount).toBe(1));

      // Emit lit:graph-updated which triggers loadEntries (new entries array reference)
      // but the expanded entry's file field is unchanged
      await act(async () => {
        emitMockEvent("lit:graph-updated", {});
      });

      // Wait for the entries reload to settle
      await waitFor(() => {
        const listCalls = invokedCommands.filter((c) => c.cmd === "list_bib_entries");
        // At least 2 list_bib_entries calls: mount + graph-updated
        expect(listCalls.length).toBeGreaterThanOrEqual(2);
      });

      // Give any redundant effect a chance to fire
      await new Promise((r) => setTimeout(r, 50));

      // The companion check should NOT have been re-issued
      expect(companionCallCount).toBe(1);
    });
  });

  describe("Open markdown button", () => {
    const sandersonWithFile: BibEntry = {
      ...sanderson,
      file: "assets/pdf/sanderson2009.pdf",
    };

    it("shows open-markdown button when OCR companion is current", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      bibKeyStatesFixture = { sanderson2009: { materialization: "materialized", page_id: "notes/sanderson.md" } };
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "is_ocr_companion_current") return "the-saiva-age.md";
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      await waitFor(() => {
        expect(screen.getByTestId("open-markdown-btn")).toBeInTheDocument();
      });
    });

    it("hides open-markdown button when OCR companion is not current", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      bibKeyStatesFixture = { sanderson2009: { materialization: "materialized", page_id: "notes/sanderson.md" } };
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "is_ocr_companion_current") return null;
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      await waitFor(() => {
        expect(screen.getByTestId("ocr-btn")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("open-markdown-btn")).not.toBeInTheDocument();
    });

    it("clicking open-markdown navigates to the companion markdown file", async () => {
      const user = userEvent.setup();
      const selectPage = vi.fn();
      useWorkspaceStore.setState({ selectPage });
      fixture = [sandersonWithFile];
      bibKeyStatesFixture = { sanderson2009: { materialization: "materialized", page_id: "notes/sanderson.md" } };
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "is_ocr_companion_current") return "the-saiva-age.md";
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await waitFor(() => {
        expect(screen.getByTestId("open-markdown-btn")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("open-markdown-btn"));
      expect(selectPage).toHaveBeenCalledWith("the-saiva-age.md");
    });
  });

  describe("Alphabet strip", () => {
    function padFixture() {
      const extra: BibEntry[] = [];
      for (let i = 0; i < 30; i++) {
        extra.push({
          key: `filler${i}`,
          authors: [`Filler${i}, Person`],
          title: `Filler entry ${i}`,
          year: "2020",
          entry_type: "article",
          line_number: 1,
          bib_file: "/workspace/refs.bib",
        });
      }
      fixture = [sanderson, flood, abrams, ...extra];
    }

    it("renders the alphabet strip when entries >= 30", async () => {
      padFixture();
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
      expect(screen.getByTestId("alphabet-strip")).toBeInTheDocument();
    });

    it("hides the alphabet strip when entries < 30", async () => {
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
      expect(screen.queryByTestId("alphabet-strip")).not.toBeInTheDocument();
    });

    it("does not render alphabet strip when no entries (empty state)", async () => {
      fixture = [];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText(/No references found/i)).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("alphabet-strip")).not.toBeInTheDocument();
    });

    it("letters present in data are enabled, others disabled", async () => {
      padFixture();
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      const letters = screen.getAllByTestId("alphabet-letter");
      const enabled = letters
        .filter((el) => !(el as HTMLButtonElement).disabled)
        .map((el) => el.getAttribute("data-letter"));
      expect(enabled).toEqual(["A", "F", "S"]);
    });

    it("clicking an enabled letter does not throw", async () => {
      padFixture();
      const user = userEvent.setup();
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      const sButton = screen
        .getAllByTestId("alphabet-letter")
        .find((el) => el.getAttribute("data-letter") === "S")!;
      await expect(user.click(sButton)).resolves.not.toThrow();
    });

    it("search narrowing hides the strip when results fall below threshold", async () => {
      padFixture();
      const user = userEvent.setup();
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
      expect(screen.getByTestId("alphabet-strip")).toBeInTheDocument();

      await user.type(screen.getByLabelText("Search references"), "Sanderson");

      await waitFor(() => {
        expect(screen.queryByTestId("alphabet-strip")).not.toBeInTheDocument();
      });
    });
  });

  describe("Entry-type-aware UI", () => {
    const bookEntry: BibEntry = {
      key: "knuth1997",
      authors: ["Knuth, Donald"],
      title: "The Art of Computer Programming",
      year: "1997",
      entry_type: "book",
      line_number: 1,
      bib_file: "/workspace/refs.bib",
      journal: undefined,
      publisher: "Addison-Wesley",
      isbn: "978-0-201-89683-1",
    };

    const articleWithPublisher: BibEntry = {
      key: "dijkstra1968",
      authors: ["Dijkstra, Edsger"],
      title: "Go To Considered Harmful",
      year: "1968",
      entry_type: "article",
      line_number: 1,
      bib_file: "/workspace/refs.bib",
      journal: "Communications of the ACM",
      publisher: "ACM",
    };

    const articleSamePublisher: BibEntry = {
      key: "turing1950",
      authors: ["Turing, Alan"],
      title: "Computing Machinery and Intelligence",
      year: "1950",
      entry_type: "article",
      line_number: 1,
      bib_file: "/workspace/refs.bib",
      journal: "Mind",
      publisher: "Mind",
    };

    const editedVolume: BibEntry = {
      key: "sanderson2015",
      authors: ["Sanderson, Alexis"],
      title: "Tolerance, Exclusion, and Persecution",
      year: "2015",
      entry_type: "incollection",
      line_number: 1,
      bib_file: "/workspace/refs.bib",
      editors: ["Florinda De Simini", "Csaba Kiss"],
      publisher: "Austrian Academy of Sciences",
      series: "BKGA 93",
      oclc: "934454286",
    };

    it("search matches editor name", async () => {
      const user = userEvent.setup();
      fixture = [editedVolume, abrams];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText("Tolerance, Exclusion, and Persecution")).toBeInTheDocument(),
      );

      await user.type(screen.getByLabelText("Search references"), "Csaba Kiss");

      expect(
        await screen.findByText("Tolerance, Exclusion, and Persecution"),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByText("Aardvark")).not.toBeInTheDocument(),
      );
    });

    it("search matches publisher field", async () => {
      const user = userEvent.setup();
      fixture = [bookEntry, flood, abrams];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText("The Art of Computer Programming")).toBeInTheDocument(),
      );

      await user.type(screen.getByLabelText("Search references"), "Addison-Wesley");

      expect(
        await screen.findByText("The Art of Computer Programming"),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByText("Aardvark")).not.toBeInTheDocument(),
      );
    });

    it("search matches isbn field", async () => {
      const user = userEvent.setup();
      fixture = [bookEntry, flood, abrams];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText("The Art of Computer Programming")).toBeInTheDocument(),
      );

      await user.type(screen.getByLabelText("Search references"), "978-0-201-89683-1");

      expect(
        await screen.findByText("The Art of Computer Programming"),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByText("Aardvark")).not.toBeInTheDocument(),
      );
    });

    it("shows entry type badge in collapsed row for 'book' type", async () => {
      fixture = [bookEntry];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText("The Art of Computer Programming")).toBeInTheDocument(),
      );

      // Not expanded — badge should still appear in collapsed row
      const badge = screen.getByTestId("entry-type-badge");
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toBe("book");
    });

    it("does not show entry type badge in collapsed row for 'article' type", async () => {
      fixture = [sanderson];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText("The Saiva Age")).toBeInTheDocument(),
      );

      expect(screen.queryByTestId("entry-type-badge")).not.toBeInTheDocument();
    });

    it("shows entry type badge for 'book' type in expanded detail view", async () => {
      const user = userEvent.setup();
      fixture = [bookEntry];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText("The Art of Computer Programming")).toBeInTheDocument(),
      );

      await user.click(screen.getByText("The Art of Computer Programming"));

      const badges = screen.getAllByTestId("entry-type-badge");
      expect(badges.length).toBeGreaterThanOrEqual(2);
      expect(badges.every((b) => b.textContent === "book")).toBe(true);
    });

    it("does not show entry type badge for 'article' type in expanded detail view", async () => {
      const user = userEvent.setup();
      fixture = [articleWithPublisher];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText("Go To Considered Harmful")).toBeInTheDocument(),
      );

      await user.click(screen.getByText("Go To Considered Harmful"));

      expect(screen.queryByTestId("entry-type-badge")).not.toBeInTheDocument();
    });

    it("shows publisher in expanded detail view when publisher differs from journal", async () => {
      const user = userEvent.setup();
      fixture = [articleWithPublisher];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText("Go To Considered Harmful")).toBeInTheDocument(),
      );

      await user.click(screen.getByText("Go To Considered Harmful"));

      const publisherEl = screen.getByTestId("entry-publisher");
      expect(publisherEl).toBeInTheDocument();
      expect(publisherEl.textContent).toBe("ACM");
    });

    it("does not show publisher in expanded detail view when publisher equals journal", async () => {
      const user = userEvent.setup();
      fixture = [articleSamePublisher];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText("Computing Machinery and Intelligence")).toBeInTheDocument(),
      );

      await user.click(screen.getByText("Computing Machinery and Intelligence"));

      expect(screen.queryByTestId("entry-publisher")).not.toBeInTheDocument();
    });

    it("shows ISBN as Open Library link in expanded detail view", async () => {
      const user = userEvent.setup();
      fixture = [bookEntry];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText("The Art of Computer Programming")).toBeInTheDocument(),
      );

      await user.click(screen.getByText("The Art of Computer Programming"));

      const isbnEl = screen.getByTestId("entry-isbn");
      expect(isbnEl).toBeInTheDocument();
      const link = isbnEl.querySelector("a");
      expect(link).toHaveAttribute(
        "href",
        "https://openlibrary.org/isbn/978-0-201-89683-1",
      );
      expect(link!.textContent).toBe("978-0-201-89683-1");
    });

    it("does not show ISBN when isbn is absent", async () => {
      const user = userEvent.setup();
      fixture = [articleWithPublisher];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText("Go To Considered Harmful")).toBeInTheDocument(),
      );

      await user.click(screen.getByText("Go To Considered Harmful"));

      expect(screen.queryByTestId("entry-isbn")).not.toBeInTheDocument();
    });

    it("shows editors in expanded detail view for edited volumes", async () => {
      const user = userEvent.setup();
      fixture = [editedVolume];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText("Tolerance, Exclusion, and Persecution")).toBeInTheDocument(),
      );

      await user.click(screen.getByText("Tolerance, Exclusion, and Persecution"));

      const editorsEl = screen.getByTestId("entry-editors");
      expect(editorsEl).toBeInTheDocument();
      expect(editorsEl.textContent).toBe("Ed. Florinda De Simini; Csaba Kiss");
    });

    it("does not show editors when editors is absent", async () => {
      const user = userEvent.setup();
      fixture = [bookEntry];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText("The Art of Computer Programming")).toBeInTheDocument(),
      );

      await user.click(screen.getByText("The Art of Computer Programming"));

      expect(screen.queryByTestId("entry-editors")).not.toBeInTheDocument();
    });
  });

  describe("Section headers", () => {
    it("renders alphabetical section headers above each letter group", async () => {
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      const headers = screen.getAllByTestId("section-header");
      const letters = headers.map((h) => h.textContent);
      expect(letters).toEqual(["A", "F", "S"]);
    });

    it("renders section headers in correct order relative to entries", async () => {
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      const list = screen.getByTestId("reference-library-list");
      const headerA = screen.getAllByTestId("section-header").find((h) => h.textContent === "A")!;
      const entryAbrams = screen.getAllByTestId("reference-entry-title").find((e) => e.textContent === "Aardvark")!;
      expect(list.compareDocumentPosition(headerA) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy();
      expect(headerA.compareDocumentPosition(entryAbrams) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("search narrows section headers to matching groups only", async () => {
      const user = userEvent.setup();
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.type(screen.getByLabelText("Search references"), "Sanderson");

      await waitFor(() => {
        const headers = screen.getAllByTestId("section-header");
        expect(headers).toHaveLength(1);
        expect(headers[0]!.textContent).toBe("S");
      });
    });

    it("clicking a section header does not expand any entry", async () => {
      const user = userEvent.setup();
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      const headerA = screen.getAllByTestId("section-header").find((h) => h.textContent === "A")!;
      await user.click(headerA);

      expect(screen.queryByText("A long abstract about Saivism.")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Copy citation/i })).not.toBeInTheDocument();
    });

    it("expanding an entry still works with section headers present", async () => {
      const user = userEvent.setup();
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      expect(screen.getByText("A long abstract about Saivism.")).toBeInTheDocument();
      expect(screen.getByText("Journal of Indology")).toBeInTheDocument();
    });

    it("single letter group shows one header", async () => {
      fixture = [sanderson];
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      const headers = screen.getAllByTestId("section-header");
      expect(headers).toHaveLength(1);
      expect(headers[0]!.textContent).toBe("S");
    });

    it("entries under the same letter share a single header", async () => {
      fixture = [
        { ...sanderson, key: "smith2020", authors: ["Smith, Alice"], title: "Smith Paper" },
        sanderson,
      ];
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("Smith Paper")).toBeInTheDocument());

      const headers = screen.getAllByTestId("section-header");
      expect(headers).toHaveLength(1);
      expect(headers[0]!.textContent).toBe("S");
      expect(screen.getAllByTestId("reference-entry-title")).toHaveLength(2);
    });
  });

  describe("Search mode dropdown and ISBN auto-detect", () => {
    async function switchToSearch(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByTestId("ref-lib-mode-search"));
    }

    it("shows search mode dropdown in search tab", async () => {
      const user = userEvent.setup();
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await switchToSearch(user);

      const chip = screen.getByLabelText("Search mode");
      expect(chip).toBeInTheDocument();
      expect(chip.textContent).toContain("Auto");
    });

    it("dropdown has Auto, Keywords, ISBN, DOI, Author, Title options", async () => {
      const user = userEvent.setup();
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await switchToSearch(user);

      await user.click(screen.getByLabelText("Search mode"));
      const dropdown = screen.getByTestId("search-mode-dropdown");
      const options = within(dropdown).getAllByRole("option");
      expect(options.map((o) => o.textContent)).toEqual(["Auto", "Keywords", "ISBN", "DOI", "Author", "Title"]);
    });

    it("shows ISBN auto-detect hint when query looks like ISBN", async () => {
      const user = userEvent.setup();
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await switchToSearch(user);

      const input = screen.getByLabelText("Search academic papers");
      await user.type(input, "9780199767465");

      expect(screen.getByTestId("isbn-auto-detect-hint")).toBeInTheDocument();
      expect(screen.getByTestId("isbn-auto-detect-hint").textContent).toContain("Searching by ISBN");
    });

    it("shows ISBN hint for hyphenated ISBN", async () => {
      const user = userEvent.setup();
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await switchToSearch(user);

      const input = screen.getByLabelText("Search academic papers");
      await user.type(input, "978-0-199-76746-5");

      expect(screen.getByTestId("isbn-auto-detect-hint")).toBeInTheDocument();
    });

    it("does not show ISBN hint for regular keywords", async () => {
      const user = userEvent.setup();
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await switchToSearch(user);

      const input = screen.getByLabelText("Search academic papers");
      await user.type(input, "machine learning");

      expect(screen.queryByTestId("isbn-auto-detect-hint")).not.toBeInTheDocument();
    });

    it("does not show ISBN hint when dropdown is explicitly set", async () => {
      const user = userEvent.setup();
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await switchToSearch(user);

      await user.click(screen.getByLabelText("Search mode"));
      const dropdown = screen.getByTestId("search-mode-dropdown");
      await user.click(within(dropdown).getByText("Keywords"));

      const input = screen.getByLabelText("Search academic papers");
      await user.type(input, "9780199767465");

      expect(screen.queryByTestId("isbn-auto-detect-hint")).not.toBeInTheDocument();
    });

    it("passes auto-detected isbn searchType to searchPapers", async () => {
      const user = userEvent.setup();
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "search_papers") return { entries: [], pdf_urls: {}, total_results: 0, providers_searched: [], providers_failed: [] };
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await switchToSearch(user);

      const input = screen.getByLabelText("Search academic papers");
      await user.type(input, "9780199767465");
      await user.click(screen.getByTestId("search-papers-btn"));

      await waitFor(() => {
        const call = invokedCommands.find((c) => c.cmd === "search_papers");
        expect(call).toBeTruthy();
        expect((call!.args as Record<string, unknown>).search_type).toBe("isbn");
      });
    });

    it("passes explicit dropdown searchType to searchPapers", async () => {
      const user = userEvent.setup();
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "search_papers") return { entries: [], pdf_urls: {}, total_results: 0, providers_searched: [], providers_failed: [] };
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await switchToSearch(user);

      await user.click(screen.getByLabelText("Search mode"));
      const dropdown = screen.getByTestId("search-mode-dropdown");
      await user.click(within(dropdown).getByText("DOI"));

      const input = screen.getByLabelText("Search academic papers");
      await user.type(input, "10.1000/xyz");
      await user.click(screen.getByTestId("search-papers-btn"));

      await waitFor(() => {
        const call = invokedCommands.find((c) => c.cmd === "search_papers");
        expect(call).toBeTruthy();
        expect((call!.args as Record<string, unknown>).search_type).toBe("doi");
      });
    });

    it("does not pass searchType for auto mode with non-ISBN query", async () => {
      const user = userEvent.setup();
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixture;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "search_papers") return { entries: [], pdf_urls: {}, total_results: 0, providers_searched: [], providers_failed: [] };
        throw new Error(`Unknown command: ${cmd}`);
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await switchToSearch(user);

      const input = screen.getByLabelText("Search academic papers");
      await user.type(input, "machine learning");
      await user.click(screen.getByTestId("search-papers-btn"));

      await waitFor(() => {
        const call = invokedCommands.find((c) => c.cmd === "search_papers");
        expect(call).toBeTruthy();
        expect((call!.args as Record<string, unknown>).search_type).toBeNull();
      });
    });
  });

  describe("Cmd+click sidebar title to open bib file", () => {
    it("Cmd+click on collapsed title calls selectPageAtLine with relative path and 1-based line", async () => {
      const selectPageAtLine = vi.fn();
      useWorkspaceStore.setState({ selectPageAtLine });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      const titleEl = screen
        .getAllByTestId("reference-entry-title")
        .find((el) => el.textContent === "The Saiva Age")!;

      fireEvent.click(titleEl, { metaKey: true });

      expect(selectPageAtLine).toHaveBeenCalledWith("refs.bib", 2);
      // Entry should NOT have expanded (stopPropagation prevented toggleExpand)
      expect(screen.queryByText("A long abstract about Saivism.")).not.toBeInTheDocument();
    });

    it("Ctrl+click on collapsed title navigates to bib file", async () => {
      const selectPageAtLine = vi.fn();
      useWorkspaceStore.setState({ selectPageAtLine });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      const titleEl = screen
        .getAllByTestId("reference-entry-title")
        .find((el) => el.textContent === "The Saiva Age")!;

      fireEvent.click(titleEl, { ctrlKey: true });

      expect(selectPageAtLine).toHaveBeenCalledWith("refs.bib", 2);
    });

    it("plain click on collapsed title still expands/collapses", async () => {
      const user = userEvent.setup();
      const selectPageAtLine = vi.fn();
      useWorkspaceStore.setState({ selectPageAtLine });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      expect(selectPageAtLine).not.toHaveBeenCalled();
      expect(screen.getByText("A long abstract about Saivism.")).toBeInTheDocument();
    });

    it("Cmd+click on expanded title navigates to bib file", async () => {
      const user = userEvent.setup();
      const selectPageAtLine = vi.fn();
      useWorkspaceStore.setState({ selectPageAtLine });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      // Expand the entry first
      await user.click(screen.getByText("The Saiva Age"));
      expect(screen.getByText("A long abstract about Saivism.")).toBeInTheDocument();

      // The expanded title is the font-semibold div, not the data-testid span
      const expandedTitle = screen.getByText("A long abstract about Saivism.")
        .closest(".mt-1.rounded")!
        .querySelector(".font-semibold")!;

      fireEvent.click(expandedTitle, { metaKey: true });

      expect(selectPageAtLine).toHaveBeenCalledWith("refs.bib", 2);
    });

    it("Cmd+click does nothing when bib_file is undefined", async () => {
      const selectPageAtLine = vi.fn();
      useWorkspaceStore.setState({ selectPageAtLine });
      fixture = [
        {
          key: "noBib2020",
          authors: ["NoBib, A."],
          title: "No Bib File Entry",
          year: "2020",
          entry_type: "article",
          line_number: 5,
          bib_file: undefined,
        },
      ];
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("No Bib File Entry")).toBeInTheDocument());

      const titleEl = screen
        .getAllByTestId("reference-entry-title")
        .find((el) => el.textContent === "No Bib File Entry")!;

      fireEvent.click(titleEl, { metaKey: true });

      expect(selectPageAtLine).not.toHaveBeenCalled();
      // The click should have bubbled up and toggled the expand
      await waitFor(() => expect(screen.queryByRole("button", { name: /Copy citation/i })).toBeInTheDocument());
    });

    it("converts 0-based line_number to 1-based for selectPageAtLine", async () => {
      const selectPageAtLine = vi.fn();
      useWorkspaceStore.setState({ selectPageAtLine });
      fixture = [
        {
          key: "zero2020",
          authors: ["Zero, Z."],
          title: "Zero Line Entry",
          year: "2020",
          entry_type: "article",
          line_number: 0,
          bib_file: "/workspace/zero.bib",
        },
      ];
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("Zero Line Entry")).toBeInTheDocument());

      const titleEl = screen
        .getAllByTestId("reference-entry-title")
        .find((el) => el.textContent === "Zero Line Entry")!;

      fireEvent.click(titleEl, { metaKey: true });

      expect(selectPageAtLine).toHaveBeenCalledWith("zero.bib", 1);
    });
  });
});

describe("EnrichCandidatePicker integration", () => {
  const candidateA: BibEntry = {
    key: "smith2020",
    authors: ["Smith, John", "Doe, Jane"],
    title: "A Great Paper (CrossRef)",
    year: "2020",
    entry_type: "article",
    line_number: 0,
    journal: "Nature",
    doi: "10.1000/xyz",
  };

  const candidateB: BibEntry = {
    key: "smith2020alt",
    authors: ["Smith, J."],
    title: "A Great Paper (S2)",
    year: "2020",
    entry_type: "book",
    line_number: 0,
  };

  const enrichResultWithCandidates = {
    entry: sanderson,
    fields_added: [],
    references_found: 0,
    references_appended: 0,
    shadow_nodes_created: 0,
    references_linked: 0,
    candidates: [candidateA, candidateB],
    providers_searched: ["CrossRef", "S2"],
    providers_failed: ["OpenAlex"],
  };

  const applyResult = {
    entry: { ...sanderson, abstract_text: "Applied abstract" },
    fields_added: ["abstract", "journal"],
    references_found: 5,
    references_appended: 5,
    shadow_nodes_created: 3,
    references_linked: 5,
    candidates: [],
    providers_searched: ["CrossRef"],
    providers_failed: [],
  };

  it("enrich with candidates opens the picker", async () => {
    const user = userEvent.setup();
    bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "enrich_bib_entry") return enrichResultWithCandidates;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("fetch-details-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("enrich-picker-dialog")).toBeInTheDocument();
    });
    expect(screen.getByText("A Great Paper (CrossRef)")).toBeInTheDocument();
    expect(screen.getByText("A Great Paper (S2)")).toBeInTheDocument();
  });

  it("apply candidate calls IPC and shows toast", async () => {
    const user = userEvent.setup();
    bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "enrich_bib_entry") return enrichResultWithCandidates;
      if (cmd === "apply_enrichment_candidate") return applyResult;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("fetch-details-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("enrich-picker-dialog")).toBeInTheDocument();
    });

    // Click first Apply button
    const applyBtns = screen.getAllByTestId("enrich-apply-btn");
    await user.click(applyBtns[0]!);

    // Picker should be closed
    await waitFor(() => {
      expect(screen.queryByTestId("enrich-picker-dialog")).not.toBeInTheDocument();
    });

    // IPC should have been called with correct args
    await waitFor(() => {
      const call = invokedCommands.find((c) => c.cmd === "apply_enrichment_candidate");
      expect(call).toBeTruthy();
      expect(call!.args).toMatchObject({
        bibKey: "sanderson2009",
        candidate: candidateA,
        workspacePath: "/workspace",
      });
    });

    // Success toast
    await waitFor(() => {
      const msg = useStatusMessageStore.getState().message;
      expect(msg).toMatch(/sanderson2009/);
    });
  });

  it("close picker without applying does not call IPC", async () => {
    const user = userEvent.setup();
    bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "enrich_bib_entry") return enrichResultWithCandidates;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("fetch-details-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("enrich-picker-dialog")).toBeInTheDocument();
    });

    // Press Escape to close
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("enrich-picker-dialog")).not.toBeInTheDocument();
    });

    // apply_enrichment_candidate should NOT have been called
    expect(invokedCommands.find((c) => c.cmd === "apply_enrichment_candidate")).toBeUndefined();
  });

  it("apply candidate error shows error toast", async () => {
    const user = userEvent.setup();
    bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "enrich_bib_entry") return enrichResultWithCandidates;
      if (cmd === "apply_enrichment_candidate") throw new Error("Apply failed");
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("fetch-details-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("enrich-picker-dialog")).toBeInTheDocument();
    });

    const applyBtns = screen.getAllByTestId("enrich-apply-btn");
    await user.click(applyBtns[0]!);

    await waitFor(() => {
      expect(useStatusMessageStore.getState().message).toMatch(/Apply failed/);
      expect(useStatusMessageStore.getState().variant).toBe("error");
    });
  });

  describe("lit:reveal-bib-entry with duplicate citekeys", () => {
    const smithA: BibEntry = {
      key: "smith2024",
      authors: ["Smith, Alice"],
      title: "Smith Paper Alpha",
      year: "2024",
      entry_type: "article",
      line_number: 1,
      bib_file: "/ws/a.bib",
      abstract_text: "ALPHA-ABSTRACT-UNIQUE",
    };

    const smithB: BibEntry = {
      key: "smith2024",
      authors: ["Smith, Bob"],
      title: "Smith Paper Beta",
      year: "2024",
      entry_type: "article",
      line_number: 1,
      bib_file: "/ws/b.bib",
      abstract_text: "BETA-ABSTRACT-UNIQUE",
    };

    it("reveals the entry from the correct bib file when duplicate citekeys exist", async () => {
      fixture = [smithA, smithB];
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("Smith Paper Alpha")).toBeInTheDocument());

      act(() => {
        window.dispatchEvent(
          new CustomEvent("lit:reveal-bib-entry", {
            detail: { citekey: "smith2024", bibFile: "b.bib" },
          }),
        );
      });

      // The second entry (from b.bib) should be expanded, showing its unique abstract
      await waitFor(() =>
        expect(screen.getByText("BETA-ABSTRACT-UNIQUE")).toBeInTheDocument(),
      );
      expect(screen.queryByText("ALPHA-ABSTRACT-UNIQUE")).not.toBeInTheDocument();
    });

    it("falls back to first citekey match when bibFile is not provided", async () => {
      fixture = [smithA, smithB];
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("Smith Paper Alpha")).toBeInTheDocument());

      act(() => {
        window.dispatchEvent(
          new CustomEvent("lit:reveal-bib-entry", {
            detail: { citekey: "smith2024" },
          }),
        );
      });

      // Without bibFile, the first match (smithA) should be expanded
      await waitFor(() =>
        expect(screen.getByText("ALPHA-ABSTRACT-UNIQUE")).toBeInTheDocument(),
      );
      expect(screen.queryByText("BETA-ABSTRACT-UNIQUE")).not.toBeInTheDocument();
    });

    it("falls back to first citekey match when bibFile matches no bib_file", async () => {
      fixture = [smithA, smithB];
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("Smith Paper Alpha")).toBeInTheDocument());

      act(() => {
        window.dispatchEvent(
          new CustomEvent("lit:reveal-bib-entry", {
            detail: { citekey: "smith2024", bibFile: "nonexistent.bib" },
          }),
        );
      });

      // bibFile doesn't match any entry, so fall back to first citekey match (smithA)
      await waitFor(() =>
        expect(screen.getByText("ALPHA-ABSTRACT-UNIQUE")).toBeInTheDocument(),
      );
      expect(screen.queryByText("BETA-ABSTRACT-UNIQUE")).not.toBeInTheDocument();
    });
  });

  describe("lit:reveal-bib-entry clears active search filter", () => {
    it("clears search filter when revealing an entry filtered out by search", async () => {
      const user = userEvent.setup();
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      // Type a search query that filters OUT sanderson2009 ("The Saiva Age")
      await user.type(screen.getByLabelText("Search references"), "Hinduism");

      // Wait for the search to take effect: "An Introduction to Hinduism" should be visible
      await waitFor(() =>
        expect(screen.getByText("An Introduction to Hinduism")).toBeInTheDocument(),
      );
      // "The Saiva Age" should be filtered out
      await waitFor(() =>
        expect(screen.queryByText("The Saiva Age")).not.toBeInTheDocument(),
      );

      // Now dispatch the reveal event for the filtered-out entry
      act(() => {
        window.dispatchEvent(
          new CustomEvent("lit:reveal-bib-entry", {
            detail: { citekey: "sanderson2009" },
          }),
        );
      });

      // The entry should become visible (expanded), proving the search was cleared
      await waitFor(() =>
        expect(screen.getByText("A long abstract about Saivism.")).toBeInTheDocument(),
      );

      // The search input should now be empty
      const searchInput = screen.getByLabelText("Search references") as HTMLInputElement;
      expect(searchInput.value).toBe("");
    });
  });

  describe("reveal flash timer cleanup on rapid clicks", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("rapid consecutive reveal events do not kill the second entry's flash early", async () => {
      render(<ReferenceLibrary />);
      await vi.advanceTimersByTimeAsync(100);
      expect(screen.getByText("The Saiva Age")).toBeInTheDocument();

      // Helper: find the container div (with bib-entry-revealed class) for a given title
      function findEntryContainer(title: string): HTMLElement | null {
        const allTitles = screen.getAllByTestId("reference-entry-title");
        const titleEl = allTitles.find((el) => el.textContent === title);
        if (!titleEl) return null;
        // Walk up to the absolutely positioned container div (the one with data-index)
        let el: HTMLElement | null = titleEl;
        while (el && !el.hasAttribute("data-index")) {
          el = el.parentElement;
        }
        return el;
      }

      // 1. Dispatch reveal for sanderson2009
      act(() => {
        window.dispatchEvent(
          new CustomEvent("lit:reveal-bib-entry", {
            detail: { citekey: "sanderson2009" },
          }),
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // sanderson entry should have the revealed class
      const sandersonContainer = findEntryContainer("The Saiva Age");
      expect(sandersonContainer).not.toBeNull();
      expect(sandersonContainer!.className).toContain("bib-entry-revealed");

      // 2. Advance 500ms (less than 1500ms) -- first entry should still be flashing
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(findEntryContainer("The Saiva Age")!.className).toContain("bib-entry-revealed");

      // 3. Dispatch reveal for flood1996
      act(() => {
        window.dispatchEvent(
          new CustomEvent("lit:reveal-bib-entry", {
            detail: { citekey: "flood1996" },
          }),
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // flood entry should now have the revealed class
      const floodContainer = findEntryContainer("An Introduction to Hinduism");
      expect(floodContainer).not.toBeNull();
      expect(floodContainer!.className).toContain("bib-entry-revealed");

      // 4. Advance 1000ms (total 1500ms from first dispatch, but only 1000ms from second).
      // WITHOUT the fix, the first setTimeout fires here and sets revealedKey to null,
      // killing flood's flash prematurely.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      const floodAfterFirstTimer = findEntryContainer("An Introduction to Hinduism");
      expect(floodAfterFirstTimer).not.toBeNull();
      expect(floodAfterFirstTimer!.className).toContain("bib-entry-revealed");

      // 5. Advance 500ms more (total 1500ms from second dispatch). Flash should end.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      const floodFinal = findEntryContainer("An Introduction to Hinduism");
      expect(floodFinal).not.toBeNull();
      expect(floodFinal!.className).not.toContain("bib-entry-revealed");
    });
  });

  describe("lit:reveal-bib-entry scroll timing uses double-rAF", () => {
    it("defers scrollToIndex through two nested requestAnimationFrame calls", async () => {
      // We spy on Element.prototype.scrollTo to detect when scrollToIndex
      // ultimately fires (TanStack Virtual calls scrollTo on the container).
      const scrollToSpy = vi.fn();
      const origScrollTo = Element.prototype.scrollTo;
      Element.prototype.scrollTo = scrollToSpy;

      // Collect rAF callbacks in a queue so we can flush them one at a time
      const rafQueue: FrameRequestCallback[] = [];
      const rafSpy = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((cb) => {
          rafQueue.push(cb);
          return rafQueue.length;
        });

      try {
        render(<ReferenceLibrary />);
        // Flush all rAFs until render stabilizes
        await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
        let safety = 0;
        while (rafQueue.length > 0 && safety < 50) {
          const cb = rafQueue.shift()!;
          cb(performance.now());
          safety++;
        }

        // Clear spies so we start with a clean slate
        scrollToSpy.mockClear();

        // Dispatch the reveal event
        act(() => {
          window.dispatchEvent(
            new CustomEvent("lit:reveal-bib-entry", {
              detail: { citekey: "sanderson2009" },
            }),
          );
        });

        // The handler should have called requestAnimationFrame (outer rAF)
        expect(rafQueue.length).toBeGreaterThanOrEqual(1);

        // Flush ONLY the first rAF callback (the handler's outer rAF).
        // With single-rAF (the bug), scrollToIndex fires here, which calls
        // scrollTo on the container element.
        // With double-rAF (the fix), this outer callback only registers
        // another rAF — scrollToIndex has NOT fired yet.
        const outerCb = rafQueue.shift()!;
        act(() => {
          outerCb(performance.now());
        });

        // KEY ASSERTION: After flushing just the outer rAF, scrollTo should
        // NOT have been called yet. With single-rAF, scrollToIndex -> scrollTo
        // would have already fired.
        expect(scrollToSpy).not.toHaveBeenCalled();

        // Now flush the inner rAF (the one registered by the outer callback).
        // After this, scrollToIndex -> scrollTo should fire.
        expect(rafQueue.length).toBeGreaterThanOrEqual(1);
        const innerCb = rafQueue.shift()!;
        act(() => {
          innerCb(performance.now());
        });

        // Now scrollTo should have been called
        expect(scrollToSpy).toHaveBeenCalled();
      } finally {
        rafSpy.mockRestore();
        Element.prototype.scrollTo = origScrollTo;
      }
    });
  });

  describe("lit:reveal-bib-entry-for-page deferred reveal", () => {
    it("defers reveal when bibKeyStates are not yet loaded and completes once they arrive", async () => {
      // Start with graphReady: false so getBibKeyStates returns {}
      useWorkspaceStore.setState({ graphReady: false });
      bibKeyStatesFixture = {};

      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      // Dispatch the reveal event before bib key states are loaded
      act(() => {
        window.dispatchEvent(
          new CustomEvent("lit:reveal-bib-entry-for-page", {
            detail: { relativePath: "notes/sanderson.md" },
          }),
        );
      });

      // Entry should NOT be expanded yet (no bibKeyStates to look up)
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByText("A long abstract about Saivism.")).not.toBeInTheDocument();

      // Now set graphReady to true and provide bib key states with a matching entry
      bibKeyStatesFixture = {
        sanderson2009: { materialization: "materialized", page_id: "notes/sanderson.md" },
      };
      act(() => {
        useWorkspaceStore.setState({ graphReady: true });
      });

      // The deferred reveal should now complete, expanding the entry
      await waitFor(() =>
        expect(screen.getByText("A long abstract about Saivism.")).toBeInTheDocument(),
      );
    });

    it("clears pending reveal when bibKeyStates load but page has no matching entry", async () => {
      // Start with graphReady: false
      useWorkspaceStore.setState({ graphReady: false });
      bibKeyStatesFixture = {};

      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      // Dispatch reveal for a path that won't match any entry
      act(() => {
        window.dispatchEvent(
          new CustomEvent("lit:reveal-bib-entry-for-page", {
            detail: { relativePath: "notes/nonexistent.md" },
          }),
        );
      });

      await new Promise((r) => setTimeout(r, 50));

      // Now load bib key states (none matching the path)
      bibKeyStatesFixture = {
        sanderson2009: { materialization: "materialized", page_id: "notes/sanderson.md" },
      };
      act(() => {
        useWorkspaceStore.setState({ graphReady: true });
      });

      // Wait for states to load and the retry to happen
      await waitFor(() =>
        expect(document.querySelector('[data-indicator="has-note"]')).toBeInTheDocument(),
      );

      // No entry should have been expanded (no match for nonexistent.md)
      expect(screen.queryByText("A long abstract about Saivism.")).not.toBeInTheDocument();
    });

    it("immediate reveal works when bibKeyStates are already loaded (regression guard)", async () => {
      // bibKeyStates are already loaded (graphReady: true by default in beforeEach)
      bibKeyStatesFixture = {
        sanderson2009: { materialization: "materialized", page_id: "notes/sanderson.md" },
      };

      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      // Wait for bib key states to load
      await waitFor(() =>
        expect(document.querySelector('[data-indicator="has-note"]')).toBeInTheDocument(),
      );

      // Dispatch the reveal event — should work immediately since states are loaded
      act(() => {
        window.dispatchEvent(
          new CustomEvent("lit:reveal-bib-entry-for-page", {
            detail: { relativePath: "notes/sanderson.md" },
          }),
        );
      });

      // Entry should be expanded immediately
      await waitFor(() =>
        expect(screen.getByText("A long abstract about Saivism.")).toBeInTheDocument(),
      );
    });
  });
});

describe("findActiveLetter", () => {
  // Layout: header D at index 0, entry d1 at index 1, entry d2 at index 2,
  //         header E at index 3, entry e1 at index 4, entry e2 at index 5.
  // Each row is 40px tall.
  const sectionedItems = [
    { kind: "header", letter: "D" },
    { kind: "entry" },
    { kind: "entry" },
    { kind: "header", letter: "E" },
    { kind: "entry" },
    { kind: "entry" },
  ];

  it("returns the correct letter when overscan items precede the viewport (the off-by-one bug)", () => {
    // Viewport scrolled to 120px (start of "E" header at index 3).
    // With overscan, virtualItems includes items from the D section that are
    // rendered above the viewport (their .start < scrollOffset).
    const virtualItems = [
      { index: 1, start: 40 },   // D-section entry (overscan, above viewport)
      { index: 2, start: 80 },   // D-section entry (overscan, above viewport)
      { index: 3, start: 120 },  // E header (first visible)
      { index: 4, start: 160 },
      { index: 5, start: 200 },
    ];

    // The fix should return "E" — the section visible at the scroll offset.
    expect(findActiveLetter(virtualItems, sectionedItems, 120)).toBe("E");
  });

  it("would return the WRONG letter with the old algorithm (proving the bug)", () => {
    // Same scenario as above. The old algorithm used virtualItems[0].index
    // (which is 1, in the D section) and walked backward to find "D".
    const virtualItems = [
      { index: 1, start: 40 },
      { index: 2, start: 80 },
      { index: 3, start: 120 },
      { index: 4, start: 160 },
      { index: 5, start: 200 },
    ];

    // Old algorithm: walk backward from virtualItems[0].index = 1 → finds "D"
    function oldFindActiveLetter(
      vis: { index: number; start: number }[],
      items: { kind: string; letter?: string }[],
    ) {
      if (vis.length === 0) return "";
      const topIndex = vis[0]!.index;
      for (let i = topIndex; i >= 0; i--) {
        const item = items[i];
        if (item?.kind === "header") return item.letter!;
      }
      return "";
    }

    expect(oldFindActiveLetter(virtualItems, sectionedItems)).toBe("D"); // wrong!
    expect(findActiveLetter(virtualItems, sectionedItems, 120)).toBe("E"); // correct
  });

  it("returns the first letter when no overscan items exist", () => {
    const virtualItems = [
      { index: 0, start: 0 },
      { index: 1, start: 40 },
      { index: 2, start: 80 },
    ];
    expect(findActiveLetter(virtualItems, sectionedItems, 0)).toBe("D");
  });

  it("returns empty string when virtualItems is empty", () => {
    expect(findActiveLetter([], sectionedItems, 0)).toBe("");
  });

  it("returns empty string when no header is found walking backward", () => {
    const items = [{ kind: "entry" }, { kind: "entry" }];
    const virtualItems = [{ index: 0, start: 0 }];
    expect(findActiveLetter(virtualItems, items, 0)).toBe("");
  });

  it("handles scrollOffset in the middle of a section", () => {
    // Scrolled to 180px — between e1 (160px) and e2 (200px).
    // First visible item is e2 at index 5, walk back to E header at index 3.
    const virtualItems = [
      { index: 2, start: 80 },   // overscan
      { index: 3, start: 120 },  // overscan
      { index: 4, start: 160 },  // overscan
      { index: 5, start: 200 },  // first visible
    ];
    expect(findActiveLetter(virtualItems, sectionedItems, 180)).toBe("E");
  });

  it("uses the overscan item correctly when all items are below the viewport", () => {
    // Edge case: scrollOffset is 0 but all virtual items start at 0+.
    // The first item with start >= 0 is the first one.
    const virtualItems = [
      { index: 3, start: 120 },
      { index: 4, start: 160 },
    ];
    expect(findActiveLetter(virtualItems, sectionedItems, 0)).toBe("E");
  });
});

describe("findBibKeyForPage", () => {
  it("returns undefined when no citekey matches the page_id", () => {
    const states: Record<string, BibKeyState> = {
      alpha2020: { materialization: "created", page_id: "notes/alpha.md" },
      beta2021: { materialization: "created", page_id: "notes/beta.md" },
    };
    expect(findBibKeyForPage(states, "notes/unrelated.md")).toBeUndefined();
  });

  it("returns the single matching citekey", () => {
    const states: Record<string, BibKeyState> = {
      alpha2020: { materialization: "created", page_id: "notes/alpha.md" },
      beta2021: { materialization: "created", page_id: "notes/beta.md" },
    };
    expect(findBibKeyForPage(states, "notes/beta.md")).toBe("beta2021");
  });

  it("returns the lexicographically smallest citekey when multiple keys share the same page_id", () => {
    const states: Record<string, BibKeyState> = {
      zebra2024: { materialization: "created", page_id: "notes/foo.md" },
      alpha2020: { materialization: "created", page_id: "notes/foo.md" },
      middle2022: { materialization: "created", page_id: "notes/foo.md" },
    };
    expect(findBibKeyForPage(states, "notes/foo.md")).toBe("alpha2020");
  });

  it("falls back to stem match when no page_id matches", () => {
    const states: Record<string, BibKeyState> = {
      marugn2001: { materialization: "created", page_id: null },
      other2022: { materialization: "created", page_id: "notes/other.md" },
    };
    expect(findBibKeyForPage(states, "notes/marugn2001.md")).toBe("marugn2001");
  });

  it("prefers exact page_id match over stem match", () => {
    const states: Record<string, BibKeyState> = {
      foo2020: { materialization: "created", page_id: "notes/foo2020.md" },
    };
    expect(findBibKeyForPage(states, "notes/foo2020.md")).toBe("foo2020");
  });

  it("stem match works for nested paths", () => {
    const states: Record<string, BibKeyState> = {
      deep2023: { materialization: "created", page_id: null },
    };
    expect(findBibKeyForPage(states, "a/b/c/deep2023.md")).toBe("deep2023");
  });

  it("returns undefined when stem does not match any citekey", () => {
    const states: Record<string, BibKeyState> = {
      alpha2020: { materialization: "created", page_id: null },
    };
    expect(findBibKeyForPage(states, "notes/nomatch.md")).toBeUndefined();
  });

  it("ignores citekeys with null page_id", () => {
    const states: Record<string, BibKeyState> = {
      nullEntry: { materialization: "created", page_id: null },
      validEntry: { materialization: "created", page_id: "notes/target.md" },
      anotherNull: { materialization: "created", page_id: null },
    };
    expect(findBibKeyForPage(states, "notes/target.md")).toBe("validEntry");
  });

  it("falls back to entries array when stem is not in states", () => {
    const states: Record<string, BibKeyState> = {
      other2020: { materialization: "created", page_id: null },
    };
    const entries: BibEntry[] = [
      { key: "uncited2023", title: "Uncited Paper", authors: [], year: "2023", entry_type: "article", bib_file: "refs.bib", line_number: 1 },
    ];
    expect(findBibKeyForPage(states, "notes/uncited2023.md", entries)).toBe("uncited2023");
  });

  it("entries fallback is skipped when entries is undefined", () => {
    const states: Record<string, BibKeyState> = {};
    expect(findBibKeyForPage(states, "notes/uncited2023.md")).toBeUndefined();
    expect(findBibKeyForPage(states, "notes/uncited2023.md", undefined)).toBeUndefined();
  });

  it("page_id and states matches take priority over entries fallback", () => {
    const states: Record<string, BibKeyState> = {
      fromState: { materialization: "created", page_id: "notes/priority.md" },
    };
    const entries: BibEntry[] = [
      { key: "priority", title: "Entry Match", authors: [], year: "2023", entry_type: "article", bib_file: "refs.bib", line_number: 1 },
    ];
    expect(findBibKeyForPage(states, "notes/priority.md", entries)).toBe("fromState");
  });
});
