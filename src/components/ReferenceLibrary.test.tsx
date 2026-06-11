import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockInvoke,
  mockListen,
  resetListenMock,
  emitMockEvent,
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
      if (cmd === "list_bib_files") return [];
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
      if (cmd === "list_bib_files") return ["/workspace/refs.bib"];
      if (cmd === "lookup_doi") return {
        key: "new2025",
        authors: ["New, A."],
        title: "New Paper",
        year: "2025",
        entry_type: "article",
        line_number: 0,
        doi: "10.1000/new",
      };
      if (cmd === "save_bib_entry") return [{ Saved: { key: "new2025" } }];
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

    await waitFor(() => {
      const select = screen.getByTestId("add-reference-bib-select") as HTMLSelectElement;
      expect(select.options.length).toBeGreaterThan(0);
    });
    fireEvent.change(screen.getByTestId("add-reference-bib-select"), {
      target: { value: "/workspace/refs.bib" },
    });

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
      expect(useStatusMessageStore.getState().message).toMatch(/Failed to create note/i),
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
    expect(useStatusMessageStore.getState().message).toMatch(/Failed to create note/i);
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
});
