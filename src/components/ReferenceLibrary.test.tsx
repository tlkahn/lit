import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, mockListen, resetListenMock } from "../test/tauri-mock";
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
