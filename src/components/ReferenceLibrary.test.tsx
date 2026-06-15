import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockInvoke,
  mockListen,
  resetListenMock,
  emitMockEvent,
  mockOnDragDropEvent,
  emitDragDropEvent,
} from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { useStatusMessageStore } from "../stores/statusMessage";
import { ReferenceLibrary } from "./ReferenceLibrary";
import { globalJumpTracker } from "../editor/jumpTracker";
import { setCurrentEditorView } from "../lib/editorViewRef";
import type { BibEntry, BacklinkEntry } from "../lib/ipc";

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

  it("renders '+ Add' button in header when entries exist", async () => {
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    const addBtn = screen.getByTestId("reference-library-add-btn");
    expect(addBtn).toBeInTheDocument();
  });

  it("renders '+ Add' button in empty state", async () => {
    fixture = [];
    render(<ReferenceLibrary />);
    await waitFor(() =>
      expect(screen.getByText(/No references found/i)).toBeInTheDocument(),
    );
    const addBtn = screen.getByTestId("reference-library-add-btn");
    expect(addBtn).toBeInTheDocument();
  });

  it("clicking '+ Add' opens the AddReferenceDialog", async () => {
    const user = userEvent.setup();
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

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

    // Open dialog
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

  it("shows 'Enriched' badge for partial materialization entries", async () => {
    bibKeyStatesFixture = { sanderson2009: { materialization: "partial", page_id: null } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    const badge = screen.getByTestId("badge-enriched");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe("Enriched");
  });

  it("shows 'Has note' badge for citekey-linked entries", async () => {
    bibKeyStatesFixture = { sanderson2009: { materialization: "materialized", page_id: "notes/sanderson.md" } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    const badge = screen.getByTestId("badge-has-note");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe("Has note");
  });

  it("no badge for shadow materialization entries", async () => {
    bibKeyStatesFixture = { sanderson2009: { materialization: "shadow", page_id: null } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    expect(screen.queryByTestId("badge-enriched")).not.toBeInTheDocument();
    expect(screen.queryByTestId("badge-has-note")).not.toBeInTheDocument();
  });

  it("no badge when bib key is absent from bibKeyStates", async () => {
    bibKeyStatesFixture = {};
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    expect(screen.queryByTestId("badge-enriched")).not.toBeInTheDocument();
    expect(screen.queryByTestId("badge-has-note")).not.toBeInTheDocument();
  });

  it("Has note badge prioritized over Enriched when page_id is present", async () => {
    bibKeyStatesFixture = { sanderson2009: { materialization: "partial", page_id: "notes/sanderson.md" } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    expect(screen.getByTestId("badge-has-note")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-enriched")).not.toBeInTheDocument();
  });

  it("expanded card shows 'Enriched' badge for partial entries", async () => {
    const user = userEvent.setup();
    bibKeyStatesFixture = { sanderson2009: { materialization: "partial", page_id: null } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));

    // The expanded card should also contain an Enriched badge
    const badges = screen.getAllByTestId("badge-enriched");
    expect(badges.length).toBeGreaterThanOrEqual(2); // collapsed row + expanded card
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
    expect(link.textContent).toContain("notes/sanderson.md");

    await user.click(link);
    expect(selectPage).toHaveBeenCalledWith("notes/sanderson.md");
  });

  it("refetches bib key states when lit:graph-updated fires", async () => {
    bibKeyStatesFixture = {};
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    expect(screen.queryByTestId("badge-enriched")).not.toBeInTheDocument();

    bibKeyStatesFixture = { sanderson2009: { materialization: "partial", page_id: null } };
    emitMockEvent("lit:graph-updated", {});

    await waitFor(() =>
      expect(screen.getByTestId("badge-enriched")).toBeInTheDocument(),
    );
  });

  it("refetches bib key states when a .bib file is modified", async () => {
    bibKeyStatesFixture = {};
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
    expect(screen.queryByTestId("badge-enriched")).not.toBeInTheDocument();

    bibKeyStatesFixture = { sanderson2009: { materialization: "partial", page_id: null } };
    emitMockEvent("workspace://file-modified", { path: "refs.bib" });

    await waitFor(() =>
      expect(screen.getByTestId("badge-enriched")).toBeInTheDocument(),
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
    expect(btn.textContent).toBe("Create note");
  });

  it("shows 'Create note' button with 'Enriched' badge for partial entries", async () => {
    const user = userEvent.setup();
    bibKeyStatesFixture = { sanderson2009: { materialization: "partial", page_id: null } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));

    expect(screen.getByTestId("create-note-btn")).toBeInTheDocument();
    const badges = screen.getAllByTestId("badge-enriched");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'Open note' link in expanded card when state.page_id is set", async () => {
    const user = userEvent.setup();
    bibKeyStatesFixture = { sanderson2009: { materialization: "materialized", page_id: "notes/sanderson.md" } };
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));

    const link = screen.getByTestId("has-note-link");
    expect(link.textContent).toContain("Open note:");
    expect(link.textContent).toContain("notes/sanderson.md");
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
    expect(btn).toHaveTextContent("Creating…");

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

    // The third (fresh) call should resolve immediately, showing the Enriched badge
    await waitFor(() =>
      expect(screen.getByTestId("badge-enriched")).toBeInTheDocument(),
    );

    // Now resolve the stale (second) call with a result that would show "Has note"
    resolveStale({ sanderson2009: { materialization: "materialized", page_id: "notes/stale.md" } });

    // Wait a bit for any erroneous state update to propagate
    await new Promise((r) => setTimeout(r, 50));

    // The stale result should have been discarded — still showing Enriched, not Has note
    expect(screen.queryByTestId("badge-has-note")).not.toBeInTheDocument();
    expect(screen.getByTestId("badge-enriched")).toBeInTheDocument();
  });

  describe("Import PDF button", () => {
    it("renders 'Import PDF...' button in header when entries exist", async () => {
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());
      const importBtn = screen.getByTestId("reference-library-import-pdf-btn");
      expect(importBtn).toBeInTheDocument();
    });

    it("renders 'Import PDF...' button in empty state", async () => {
      fixture = [];
      render(<ReferenceLibrary />);
      await waitFor(() =>
        expect(screen.getByText(/No references found/i)).toBeInTheDocument(),
      );
      const importBtn = screen.getByTestId("reference-library-import-pdf-btn");
      expect(importBtn).toBeInTheDocument();
    });

    it("clicking 'Import PDF...' opens the ImportPdfDialog", async () => {
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

      // Open dialog
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
      expect(btn.textContent).toBe("Fetch details");
    });

    it("shows 'Refresh' button for partial materialization entries without page_id", async () => {
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

      const btn = screen.getByTestId("fetch-details-btn");
      expect(btn).toBeInTheDocument();
      expect(btn.textContent).toBe("Refresh");
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
      expect(btn.textContent).toBe("Fetch details");
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
        expect(btn.textContent).toMatch(/Fetching/i);
      });

      await act(async () => {
        resolveEnrich(enrichResult);
      });

      await waitFor(() => {
        const btn = screen.getByTestId("fetch-details-btn");
        expect(btn).not.toBeDisabled();
        expect(btn.textContent).toBe("Fetch details");
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

  it("shows Delete button in expanded row", async () => {
    const user = userEvent.setup();
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));

    expect(screen.getByTestId("delete-entry-btn")).toBeInTheDocument();
    expect(screen.getByTestId("delete-entry-btn").textContent).toBe("Delete");
  });

  it("Delete button calls bibDelete and reloads on success", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "bib_delete") return true;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("delete-entry-btn"));

    await waitFor(() => {
      const call = invokedCommands.find((c) => c.cmd === "bib_delete");
      expect(call).toBeTruthy();
      expect(call!.args).toEqual({ citeKey: "sanderson2009", workspacePath: "/workspace" });
    });

    vi.mocked(window.confirm).mockRestore();
  });

  it("Delete button shows confirm dialog before deleting", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "bib_delete") return true;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("delete-entry-btn"));

    expect(invokedCommands.find((c) => c.cmd === "bib_delete")).toBeUndefined();

    vi.mocked(window.confirm).mockRestore();
  });

  it("Delete button shows error toast on failure", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "bib_delete") throw new Error("DB locked");
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("delete-entry-btn"));

    await waitFor(() => {
      expect(useStatusMessageStore.getState().message).toMatch(/DB locked/);
      expect(useStatusMessageStore.getState().variant).toBe("error");
    });

    vi.mocked(window.confirm).mockRestore();
  });

  it("shows Edit button in expanded row", async () => {
    const user = userEvent.setup();
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));

    expect(screen.getByTestId("edit-entry-btn")).toBeInTheDocument();
  });

  it("clicking Edit shows inline edit fields with pre-populated values", async () => {
    const user = userEvent.setup();
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("edit-entry-btn"));

    const titleInput = screen.getByTestId("edit-field-title") as HTMLInputElement;
    expect(titleInput.value).toBe("The Saiva Age");
    const authorsInput = screen.getByTestId("edit-field-authors") as HTMLInputElement;
    expect(authorsInput.value).toBe("Sanderson, Alexis");
    const yearInput = screen.getByTestId("edit-field-year") as HTMLInputElement;
    expect(yearInput.value).toBe("2009");
    const journalInput = screen.getByTestId("edit-field-journal") as HTMLInputElement;
    expect(journalInput.value).toBe("Journal of Indology");
  });

  it("Edit Cancel returns to display mode", async () => {
    const user = userEvent.setup();
    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("edit-entry-btn"));
    expect(screen.getByTestId("edit-field-title")).toBeInTheDocument();

    await user.click(screen.getByTestId("edit-cancel-btn"));
    expect(screen.queryByTestId("edit-field-title")).not.toBeInTheDocument();
    // Static display should be restored — title text visible (in both collapsed row and expanded card)
    expect(screen.getAllByText("The Saiva Age").length).toBeGreaterThanOrEqual(1);
  });

  it("Edit Save calls bibUpdateFields and reloads", async () => {
    const user = userEvent.setup();
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "bib_update_fields") {
        // Simulate backend emitting the event (as bib_update_fields does in production)
        emitMockEvent("lit:bib-items-changed", {});
        return true;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("edit-entry-btn"));

    const titleInput = screen.getByTestId("edit-field-title") as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, "Updated Title");

    const beforeCount = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;

    await user.click(screen.getByTestId("edit-save-btn"));

    await waitFor(() => {
      const call = invokedCommands.find((c) => c.cmd === "bib_update_fields");
      expect(call).toBeTruthy();
      expect(call!.args).toMatchObject({
        citeKey: "sanderson2009",
        workspacePath: "/workspace",
      });
    });
    await waitFor(() => {
      const afterCount = invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
      expect(afterCount).toBeGreaterThan(beforeCount);
    });
    // Edit mode should be exited
    expect(screen.queryByTestId("edit-field-title")).not.toBeInTheDocument();
  });

  it("Edit Save shows error toast on failure", async () => {
    const user = userEvent.setup();
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "bib_update_fields") throw new Error("Update failed");
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("edit-entry-btn"));

    // Change a field so the diff-based save actually sends a request
    const titleInput = screen.getByTestId("edit-field-title") as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, "Trigger Error");

    await user.click(screen.getByTestId("edit-save-btn"));

    await waitFor(() => {
      expect(useStatusMessageStore.getState().message).toMatch(/Update failed/);
      expect(useStatusMessageStore.getState().variant).toBe("error");
    });
  });

  it("Edit Save sends empty string when field is cleared", async () => {
    const user = userEvent.setup();
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "bib_update_fields") return true;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("edit-entry-btn"));

    const journalInput = screen.getByTestId("edit-field-journal") as HTMLInputElement;
    await user.clear(journalInput);

    await user.click(screen.getByTestId("edit-save-btn"));

    await waitFor(() => {
      const call = invokedCommands.find((c) => c.cmd === "bib_update_fields");
      expect(call).toBeTruthy();
      expect(call!.args).toMatchObject({
        citeKey: "sanderson2009",
        fields: { journal: "" },
      });
    });
  });

  it("Edit Save does not send unchanged fields", async () => {
    const user = userEvent.setup();
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "bib_update_fields") return true;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("edit-entry-btn"));
    // Don't change any fields, just click save
    await user.click(screen.getByTestId("edit-save-btn"));

    // bib_update_fields should NOT be called since nothing changed
    await waitFor(() => {
      expect(screen.queryByTestId("edit-field-title")).not.toBeInTheDocument();
    });
    const updateCall = invokedCommands.find((c) => c.cmd === "bib_update_fields");
    expect(updateCall).toBeUndefined();
  });

  it("Edit Save sends only changed fields", async () => {
    const user = userEvent.setup();
    mockInvoke((cmd, args) => {
      invokedCommands.push({ cmd, args });
      if (cmd === "list_bib_entries") return fixture;
      if (cmd === "get_citing_pages") return citingFixture;
      if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
      if (cmd === "bib_update_fields") return true;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ReferenceLibrary />);
    await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

    await user.click(screen.getByText("The Saiva Age"));
    await user.click(screen.getByTestId("edit-entry-btn"));

    const titleInput = screen.getByTestId("edit-field-title") as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, "New Title Only");

    await user.click(screen.getByTestId("edit-save-btn"));

    await waitFor(() => {
      const call = invokedCommands.find((c) => c.cmd === "bib_update_fields");
      expect(call).toBeTruthy();
      const fields = (call!.args as Record<string, unknown>).fields as Record<string, string>;
      expect(fields.title).toBe("New Title Only");
      // authors, year, journal should NOT be in the fields
      expect(fields).not.toHaveProperty("authors");
      expect(fields).not.toHaveProperty("year");
      expect(fields).not.toHaveProperty("journal");
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
      expect(screen.getByTestId("download-pdf-btn").textContent).toBe("Download PDF");
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
        expect(btn.textContent).toBe("Resolving…");
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
        expect(btn.textContent).toBe("Download PDF");
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
        expect(btn.textContent).toBe("Download PDF");
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
        expect(screen.getByTestId("download-pdf-btn").textContent).toBe("Downloading 50%");
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
        expect(screen.getByTestId("download-pdf-btn").textContent).toBe("Downloading…");
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
      expect(screen.getByTestId("download-pdf-btn").textContent).toBe("Resolving…");

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
        if (cmd === "ocr_pdf_to_markdown") {
          if (handlers?.ocrPdfToMarkdown) return handlers.ocrPdfToMarkdown(cmd, args as unknown);
          return "ocr/sanderson2009.md";
        }
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
      expect(screen.getByTestId("ocr-btn").textContent).toBe("OCR to Markdown");
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
  });

  describe("Zotero preview and availability", () => {
    const sandersonWithFile: BibEntry = {
      ...sanderson,
      doi: "10.1000/xyz",
      file: "assets/pdf/sanderson2009.pdf",
    };

    function setupMockWithZotero(
      fixtureOverride: BibEntry[],
      overrides: {
        previewZoteroImport?: (cmd: string, args: unknown) => unknown;
        checkAvailability?: (cmd: string, args: unknown) => unknown;
        importZotero?: (cmd: string, args: unknown) => unknown;
      } = {},
    ) {
      mockInvoke((cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === "list_bib_entries") return fixtureOverride;
        if (cmd === "get_citing_pages") return citingFixture;
        if (cmd === "get_bib_key_states") return bibKeyStatesFixture;
        if (cmd === "preview_zotero_import") {
          if (overrides.previewZoteroImport) return overrides.previewZoteroImport(cmd, args as unknown);
          return {
            annotations: [
              { text: "highlighted text", comment: null, matchType: "exact", confidence: 1.0, targetLine: 42, pageLabel: "5", annType: "highlight" },
              { text: null, comment: "sticky note", matchType: "unmatched", confidence: 0.0, targetLine: null, pageLabel: "3", annType: "note" },
            ],
            total: 5,
            matched: 2,
            unmatched: 1,
            alreadyImported: 2,
          };
        }
        if (cmd === "check_zotero_annotations_available") {
          if (overrides.checkAvailability) return overrides.checkAvailability(cmd, args as unknown);
          return { available: 10, imported: 3 };
        }
        if (cmd === "import_zotero_annotations") {
          if (overrides.importZotero) return overrides.importZotero(cmd, args as unknown);
          return { inserted: 3, unmatched: 1, skipped: 2, llmPlaced: 0, modified: 0 };
        }
        throw new Error(`Unknown command: ${cmd}`);
      });
    }

    it("clicking Zotero Annotations triggers preview, shows panel", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      setupMockWithZotero(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("import-zotero-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("zotero-preview-panel")).toBeInTheDocument();
      });
      expect(screen.getByText(/5 annotations/)).toBeInTheDocument();
      expect(screen.getByText(/2 matched/)).toBeInTheDocument();
      expect(screen.getByText(/2 already imported/)).toBeInTheDocument();
    });

    it("preview panel confirm button triggers import", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      setupMockWithZotero(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("import-zotero-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("zotero-preview-panel")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("preview-confirm-btn"));

      await waitFor(() => {
        const importCall = invokedCommands.find((c) => c.cmd === "import_zotero_annotations");
        expect(importCall).toBeTruthy();
      });
    });

    it("preview panel cancel button clears preview", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      setupMockWithZotero(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("import-zotero-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("zotero-preview-panel")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("preview-cancel-btn"));

      await waitFor(() => {
        expect(screen.queryByTestId("zotero-preview-panel")).not.toBeInTheDocument();
      });
    });

    it("shows 'N new' badge when availability has new annotations", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      setupMockWithZotero(fixture);
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      await waitFor(() => {
        expect(screen.getByTestId("zotero-availability-badge")).toBeInTheDocument();
      });
      expect(screen.getByTestId("zotero-availability-badge").textContent).toBe("7 new");
    });

    it("shows 'synced' badge when all annotations are imported", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      setupMockWithZotero(fixture, {
        checkAvailability: () => ({ available: 5, imported: 5 }),
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      await waitFor(() => {
        expect(screen.getByTestId("zotero-availability-badge")).toBeInTheDocument();
      });
      expect(screen.getByTestId("zotero-availability-badge").textContent).toBe("synced");
    });

    it("shows no badge when no annotations available", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      setupMockWithZotero(fixture, {
        checkAvailability: () => ({ available: 0, imported: 0 }),
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));

      // Wait for availability check to complete, then verify no badge
      await waitFor(() => {
        const availCall = invokedCommands.find((c) => c.cmd === "check_zotero_annotations_available");
        expect(availCall).toBeTruthy();
      });
      expect(screen.queryByTestId("zotero-availability-badge")).not.toBeInTheDocument();
    });

    it("short-circuits when preview reports 0 total annotations", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      setupMockWithZotero(fixture, {
        previewZoteroImport: () => ({
          annotations: [],
          total: 0,
          matched: 0,
          unmatched: 0,
          alreadyImported: 0,
        }),
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("import-zotero-btn"));

      await waitFor(() => {
        const previewCall = invokedCommands.find((c) => c.cmd === "preview_zotero_import");
        expect(previewCall).toBeTruthy();
      });
      // No preview panel should appear for 0 total
      expect(screen.queryByTestId("zotero-preview-panel")).not.toBeInTheDocument();
    });

    it("short-circuits when all annotations already imported", async () => {
      const user = userEvent.setup();
      fixture = [sandersonWithFile];
      setupMockWithZotero(fixture, {
        previewZoteroImport: () => ({
          annotations: [],
          total: 5,
          matched: 0,
          unmatched: 0,
          alreadyImported: 5,
        }),
      });
      render(<ReferenceLibrary />);
      await waitFor(() => expect(screen.getByText("The Saiva Age")).toBeInTheDocument());

      await user.click(screen.getByText("The Saiva Age"));
      await user.click(screen.getByTestId("import-zotero-btn"));

      await waitFor(() => {
        const previewCall = invokedCommands.find((c) => c.cmd === "preview_zotero_import");
        expect(previewCall).toBeTruthy();
      });
      // No preview panel should appear when all already imported
      expect(screen.queryByTestId("zotero-preview-panel")).not.toBeInTheDocument();
    });
  });
});
