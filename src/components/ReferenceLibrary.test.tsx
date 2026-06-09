import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
import type { BibEntry } from "../lib/ipc";

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
let clipboardOverridden = false;
const origClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

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
  resetListenMock();
  mockListen();
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
    invokedCommands.push({ cmd, args });
    if (cmd === "list_bib_entries") return fixture;
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
});
