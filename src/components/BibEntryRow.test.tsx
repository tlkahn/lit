import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BibEntryRow } from "./BibEntryRow";
import type { BibEntryRowProps } from "./BibEntryRow";
import type { BibEntryActionProps } from "./BibEntryActions";
import { useWorkspaceStore } from "../stores/workspace";
import { mockInvoke, mockListen, resetListenMock } from "../test/tauri-mock";
import type { BibEntry, BibKeyState } from "../lib/ipc";

const baseEntry: BibEntry = {
  key: "sanderson2009",
  authors: ["Sanderson, Alexis", "Goodall, Dominic"],
  title: "The Saiva Age",
  year: "2009",
  entry_type: "book",
  line_number: 1,
  bib_file: "/workspace/refs.bib",
  journal: "Journal of Indology",
  publisher: "Brill",
  isbn: "9781234567890",
  doi: "10.1000/xyz",
  url: "https://example.org/a",
  abstract_text: "A long abstract about Saivism.",
  editors: ["Editor, One"],
  tags: ["tantra", "history"],
};

const sparseEntry: BibEntry = {
  key: "abrams2001",
  authors: ["Abrams, M."],
  title: "Aardvark",
  year: "2001",
  entry_type: "article",
  line_number: 1,
  bib_file: "/workspace/refs.bib",
};

const actionHandlers = (): Pick<
  BibEntryActionProps,
  | "onOpenNote"
  | "onCreateNote"
  | "onEnrich"
  | "onOpenPdf"
  | "onOpenMarkdown"
  | "onOcr"
  | "onCopyCitation"
  | "onDownloadPdf"
  | "onLinkPdf"
> => ({
  onOpenNote: vi.fn(),
  onCreateNote: vi.fn(),
  onEnrich: vi.fn(),
  onOpenPdf: vi.fn(),
  onOpenMarkdown: vi.fn(),
  onOcr: vi.fn(),
  onCopyCitation: vi.fn(),
  onDownloadPdf: vi.fn(),
  onLinkPdf: vi.fn(),
});

const defaultActionLoading = {
  isMaterializing: false,
  isEnriching: false,
  enrichPhase: "fetch" as const,
  isDownloading: false,
  downloadProgress: null,
  isLinking: false,
};

function renderRow(overrides: {
  entry?: BibEntry;
  isExpanded?: boolean;
  modHeld?: boolean;
  onToggleExpand?: (...args: unknown[]) => void;
  onNavigateToBibFile?: (entry: BibEntry) => void;
  actionProps?: Partial<BibEntryActionProps>;
} = {}) {
  const entry = overrides.entry ?? baseEntry;
  const ah = actionHandlers();
  const props: BibEntryRowProps = {
    entry,
    isExpanded: overrides.isExpanded ?? false,
    modHeld: overrides.modHeld ?? false,
    onToggleExpand: (overrides.onToggleExpand ?? vi.fn()) as (entryId: string) => void,
    onNavigateToBibFile: overrides.onNavigateToBibFile ?? vi.fn(),
    actionProps: {
      entry,
      state: undefined,
      ocrCompanionCurrent: undefined,
      ...defaultActionLoading,
      ...ah,
      ...overrides.actionProps,
    },
  };
  render(<BibEntryRow {...props} />);
  return props;
}

beforeEach(() => {
  resetListenMock();
  mockListen();
  mockInvoke((cmd) => {
    if (cmd === "get_citing_pages") return [];
    throw new Error(`Unknown command: ${cmd}`);
  });
  useWorkspaceStore.setState({
    workspacePath: "/workspace",
    currentPagePath: null,
    graphReady: false,
  });
});

describe("BibEntryRow — collapsed row", () => {
  it("renders the entry title in collapsed state", () => {
    renderRow();
    expect(screen.getByTestId("reference-entry-title")).toHaveTextContent("The Saiva Age");
  });

  it("renders authors joined with '; ' and year in parentheses", () => {
    renderRow();
    expect(
      screen.getByText("Sanderson, Alexis; Goodall, Dominic (2009)"),
    ).toBeInTheDocument();
  });

  it("renders the EntryTypeBadge for a badge-worthy type", () => {
    renderRow();
    expect(screen.getByTestId("entry-type-badge")).toHaveTextContent("book");
  });

  it("calls onToggleExpand when the row is clicked", async () => {
    const user = userEvent.setup();
    const props = renderRow();
    await user.click(screen.getByTestId("reference-entry-title"));
    expect(props.onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it("Cmd/Ctrl+click on the title calls onNavigateToBibFile", () => {
    const props = renderRow();
    fireEvent.click(screen.getByTestId("reference-entry-title"), { metaKey: true });
    expect(props.onNavigateToBibFile).toHaveBeenCalledWith(baseEntry);
  });

  it("plain click on the title does not call onNavigateToBibFile", async () => {
    const user = userEvent.setup();
    const props = renderRow();
    await user.click(screen.getByTestId("reference-entry-title"));
    expect(props.onNavigateToBibFile).not.toHaveBeenCalled();
  });

  it("title has accent/underline class when modHeld and bib_file present", () => {
    renderRow({ modHeld: true });
    const title = screen.getByTestId("reference-entry-title");
    expect(title.className).toContain("underline");
    expect(title.className).toContain("text-interactive-accent");
  });

  it("title has normal class when modHeld is false", () => {
    renderRow({ modHeld: false });
    const title = screen.getByTestId("reference-entry-title");
    expect(title.className).not.toContain("underline");
    expect(title.className).toContain("text-text-normal");
  });
});

describe("BibEntryRow — expanded panel", () => {
  it("renders full metadata when isExpanded", () => {
    renderRow({ isExpanded: true });
    // title appears twice (collapsed + expanded header)
    expect(screen.getAllByText("The Saiva Age").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("entry-editors")).toHaveTextContent("Ed. Editor, One");
    expect(screen.getByText("Journal of Indology")).toBeInTheDocument();
    expect(screen.getByTestId("entry-publisher")).toHaveTextContent("Brill");
    expect(screen.getByTestId("entry-isbn")).toHaveTextContent("9781234567890");
    expect(screen.getByRole("link", { name: "10.1000/xyz" })).toHaveAttribute(
      "href",
      "https://doi.org/10.1000/xyz",
    );
    expect(screen.getByRole("link", { name: "https://example.org/a" })).toHaveAttribute(
      "href",
      "https://example.org/a",
    );
    expect(screen.getByText("A long abstract about Saivism.")).toBeInTheDocument();
    expect(screen.getByText("tantra")).toBeInTheDocument();
    expect(screen.getByText("history")).toBeInTheDocument();
  });

  it("omits absent fields for a sparse entry", () => {
    renderRow({ entry: sparseEntry, isExpanded: true });
    expect(screen.queryByTestId("entry-editors")).not.toBeInTheDocument();
    expect(screen.queryByTestId("entry-publisher")).not.toBeInTheDocument();
    expect(screen.queryByTestId("entry-isbn")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText("Journal of Indology")).not.toBeInTheDocument();
  });

  it("does not render the expanded panel when collapsed", () => {
    renderRow({ isExpanded: false });
    expect(screen.queryByTestId("entry-isbn")).not.toBeInTheDocument();
  });
});

describe("BibEntryRow — BibEntryActions wiring", () => {
  it("renders BibEntryActions and wires onCopyCitation", async () => {
    const user = userEvent.setup();
    const state: BibKeyState = { materialization: "shadow", page_id: null };
    const props = renderRow({ isExpanded: true, actionProps: { state } });
    const copyBtn = screen.getByRole("button", { name: "Copy citation" });
    await user.click(copyBtn);
    expect(props.actionProps.onCopyCitation).toHaveBeenCalledWith("sanderson2009");
  });

  it("wires onCreateNote through the create-note button", async () => {
    const user = userEvent.setup();
    const state: BibKeyState = { materialization: "shadow", page_id: null };
    const props = renderRow({ isExpanded: true, actionProps: { state } });
    await user.click(screen.getByTestId("create-note-btn"));
    expect(props.actionProps.onCreateNote).toHaveBeenCalledWith("sanderson2009");
  });
});

describe("BibEntryRow — CitedBySection", () => {
  it("renders 'Cited by (N)' when graph is ready and citations exist", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_citing_pages") {
        return [
          { source_id: "notes/a.md", source_title: "Note A", context: "see this", source_line: 4 },
          { source_id: "notes/b.md", source_title: "Note B", context: "", source_line: 9 },
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    useWorkspaceStore.setState({ graphReady: true });
    renderRow({ isExpanded: true });
    expect(
      await screen.findByRole("button", { name: /Cited by \(2\)/ }),
    ).toBeInTheDocument();
  });

  it("shows 'Not cited' when there are no citations", async () => {
    useWorkspaceStore.setState({ graphReady: true });
    renderRow({ isExpanded: true });
    expect(await screen.findByText("Not cited")).toBeInTheDocument();
  });

  it("does not render cited-by content before graph is ready", () => {
    useWorkspaceStore.setState({ graphReady: false });
    renderRow({ isExpanded: true });
    expect(screen.queryByText(/Cited by|Not cited/)).not.toBeInTheDocument();
  });
});
