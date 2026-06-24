import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BibEntryRow } from "./BibEntryRow";
import type { BibEntryRowProps } from "./BibEntryRow";
import type { BibEntryActionProps } from "./BibEntryActions";
import { useWorkspaceStore } from "../stores/workspace";
import { mockInvoke, mockListen, resetListenMock, emitMockEvent } from "../test/tauri-mock";
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
  referenceCount?: number;
  onDrillDown?: (entry: BibEntry) => void;
  actionProps?: Partial<BibEntryActionProps>;
} = {}) {
  const entry = overrides.entry ?? baseEntry;
  const ah = actionHandlers();
  const props: BibEntryRowProps = {
    isExpanded: overrides.isExpanded ?? false,
    modHeld: overrides.modHeld ?? false,
    onToggleExpand: (overrides.onToggleExpand ?? vi.fn()) as (entryId: string) => void,
    onNavigateToBibFile: overrides.onNavigateToBibFile ?? vi.fn(),
    referenceCount: overrides.referenceCount,
    onDrillDown: overrides.onDrillDown,
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

  it("renders drill-down badge when referenceCount > 0 and onDrillDown provided", () => {
    renderRow({ referenceCount: 5, onDrillDown: vi.fn() });
    const badge = screen.getByTestId("drill-down-btn");
    expect(badge).toHaveTextContent("5 refs ›");
  });

  it("does not render drill-down badge when referenceCount is 0", () => {
    renderRow({ referenceCount: 0, onDrillDown: vi.fn() });
    expect(screen.queryByTestId("drill-down-btn")).not.toBeInTheDocument();
  });

  it("does not render drill-down badge when referenceCount is undefined", () => {
    renderRow({ onDrillDown: vi.fn() });
    expect(screen.queryByTestId("drill-down-btn")).not.toBeInTheDocument();
  });

  it("does not render drill-down badge when onDrillDown is not provided", () => {
    renderRow({ referenceCount: 3 });
    expect(screen.queryByTestId("drill-down-btn")).not.toBeInTheDocument();
  });

  it("clicking drill-down badge calls onDrillDown with the entry", async () => {
    const user = userEvent.setup();
    const onDrillDown = vi.fn();
    renderRow({ referenceCount: 3, onDrillDown });
    await user.click(screen.getByTestId("drill-down-btn"));
    expect(onDrillDown).toHaveBeenCalledWith(baseEntry);
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

  it("Cmd/Ctrl+click on expanded title calls onNavigateToBibFile", () => {
    const props = renderRow({ isExpanded: true });
    fireEvent.click(screen.getByTestId("expanded-entry-title"), { metaKey: true });
    expect(props.onNavigateToBibFile).toHaveBeenCalledWith(baseEntry);
  });

  it("expanded title has accent/underline class when modHeld and bib_file present", () => {
    renderRow({ isExpanded: true, modHeld: true });
    const title = screen.getByTestId("expanded-entry-title");
    expect(title.className).toContain("underline");
    expect(title.className).toContain("text-interactive-accent");
  });

  it("expanded title has normal class when modHeld is false", () => {
    renderRow({ isExpanded: true, modHeld: false });
    const title = screen.getByTestId("expanded-entry-title");
    expect(title.className).not.toContain("underline");
    expect(title.className).toContain("text-text-normal");
  });

  it("renders non-HTTP url with href '#' (ftp)", () => {
    renderRow({
      isExpanded: true,
      entry: { ...baseEntry, url: "ftp://example.com" },
    });
    expect(
      screen.getByRole("link", { name: "ftp://example.com" }),
    ).toHaveAttribute("href", "#");
  });

  it("renders malformed HTTP url with href '#'", () => {
    renderRow({
      isExpanded: true,
      entry: { ...baseEntry, url: "https://" },
    });
    expect(
      screen.getByRole("link", { name: "https://" }),
    ).toHaveAttribute("href", "#");
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

function makeProps(overrides: {
  entry?: BibEntry;
  isExpanded?: boolean;
  modHeld?: boolean;
  onToggleExpand?: (entryId: string) => void;
  onNavigateToBibFile?: (entry: BibEntry) => void;
  actionProps?: Partial<BibEntryActionProps>;
} = {}): BibEntryRowProps {
  const entry = overrides.entry ?? baseEntry;
  const ah = actionHandlers();
  return {
    isExpanded: overrides.isExpanded ?? false,
    modHeld: overrides.modHeld ?? false,
    onToggleExpand: overrides.onToggleExpand ?? vi.fn(),
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
}

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

  it("re-fetches citing pages when bibKey changes", async () => {
    const invokedCalls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    mockInvoke((cmd, args) => {
      invokedCalls.push({ cmd, args });
      if (cmd === "get_citing_pages") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });
    useWorkspaceStore.setState({ graphReady: true });

    const props1 = makeProps({ isExpanded: true });
    const { rerender } = render(<BibEntryRow {...props1} />);
    await screen.findByText("Not cited");

    // Verify initial fetch was with the original key
    expect(invokedCalls.some(
      (c) => c.cmd === "get_citing_pages" && (c.args as Record<string, unknown>)?.bibKey === "sanderson2009",
    )).toBe(true);

    // Clear and re-render with a different bibKey
    invokedCalls.length = 0;
    const otherEntry: BibEntry = { ...baseEntry, key: "otherKey2024", title: "Other Paper" };
    const props2 = makeProps({ entry: otherEntry, isExpanded: true });
    rerender(<BibEntryRow {...props2} />);

    await screen.findByText("Not cited");
    expect(invokedCalls.some(
      (c) => c.cmd === "get_citing_pages" && (c.args as Record<string, unknown>)?.bibKey === "otherKey2024",
    )).toBe(true);
  });

  it("graph-updated event after bibKey change fetches with new key", async () => {
    const invokedCalls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    mockInvoke((cmd, args) => {
      invokedCalls.push({ cmd, args });
      if (cmd === "get_citing_pages") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });
    useWorkspaceStore.setState({ graphReady: true });

    const props1 = makeProps({ isExpanded: true });
    const { rerender } = render(<BibEntryRow {...props1} />);
    await screen.findByText("Not cited");

    // Re-render with a different bibKey
    const otherEntry: BibEntry = { ...baseEntry, key: "otherKey2024", title: "Other Paper" };
    const props2 = makeProps({ entry: otherEntry, isExpanded: true });
    rerender(<BibEntryRow {...props2} />);
    await screen.findByText("Not cited");

    // Clear call history and emit graph-updated
    invokedCalls.length = 0;
    emitMockEvent("lit:graph-updated", {});

    // Wait for the async fetch triggered by the event
    await vi.waitFor(() => {
      expect(invokedCalls.some(
        (c) => c.cmd === "get_citing_pages" && (c.args as Record<string, unknown>)?.bibKey === "otherKey2024",
      )).toBe(true);
    });
  });
});
