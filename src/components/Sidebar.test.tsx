import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, mockListen, emitMockEvent, resetListenMock } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { useStatusMessageStore } from "../stores/statusMessage";
import { useFileTreeSelectionStore } from "../stores/fileTreeSelection";
import { Sidebar, SIDEBAR_WIDTH_PX } from "./Sidebar";
import type { BibEntry } from "../lib/ipc";

let invokedCommands: { cmd: string; args: unknown }[] = [];
let referenceFixture: BibEntry[] = [];

beforeEach(() => {
  invokedCommands = [];
  referenceFixture = [];
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

  mockInvoke((cmd, args) => {
    invokedCommands.push({ cmd, args });
    if (cmd === "create_page") {
      const name = (args as Record<string, unknown>)?.name as string;
      return {
        title: name,
        relative_path: `${name}.md`,
        frontmatter: {},
        created_at: 1000,
        modified_at: 1000,
        file_type: 'markdown' as const,
      };
    }
    if (cmd === "open_in_external_editor") {
      return null;
    }
    if (cmd === "show_sidebar_context_menu") {
      return null;
    }
    if (cmd === "list_bib_entries") {
      return referenceFixture;
    }
    throw new Error(`Unknown command: ${cmd}`);
  });
  useFileTreeSelectionStore.getState().clear();
});

describe("Sidebar tabs", () => {
  it("renders Files and Outline tab buttons", () => {
    render(<Sidebar />);
    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Outline" })).toBeInTheDocument();
  });

  it("Files tab is active by default", () => {
    render(<Sidebar />);
    expect(screen.getByLabelText("Search pages")).toBeInTheDocument();
  });

  it("does not render a 'New page' button (moved to StatusBar)", () => {
    render(<Sidebar />);
    expect(screen.queryByRole("button", { name: "New page" })).not.toBeInTheDocument();
  });

  it("clicking Outline switches to outline; clicking Files switches back", async () => {
    useWorkspaceStore.setState({ currentPagePath: null });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByRole("button", { name: "Outline" }));
    expect(screen.getByText("No page selected")).toBeInTheDocument();
    expect(screen.queryByLabelText("Search pages")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByLabelText("Search pages")).toBeInTheDocument();
  });

  it("renders a References tab button", () => {
    render(<Sidebar />);
    expect(screen.getByRole("button", { name: "References" })).toBeInTheDocument();
  });

  it("clicking References switches to the references panel", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByRole("button", { name: "References" }));
    expect(screen.queryByLabelText("Search pages")).not.toBeInTheDocument();
    expect(await screen.findByText(/No references found/i)).toBeInTheDocument();
  });

  it("clicking References persists the tab to localStorage", async () => {
    localStorage.removeItem("lit-sidebar-tab");
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByRole("button", { name: "References" }));
    expect(localStorage.getItem("lit-sidebar-tab")).toBe("references");
    localStorage.removeItem("lit-sidebar-tab");
  });

  it("Files tab shows search + tree; Outline tab shows Outline component", async () => {
    useWorkspaceStore.setState({
      currentPagePath: "test.md",
      currentPageHeadings: [{ level: 1, text: "Hello", line: 0, from: 0, to: 7 }],
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    expect(screen.getByLabelText("Search pages")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Outline" }));
    expect(screen.queryByLabelText("Search pages")).not.toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});

describe("Sidebar accent-insensitive filter", () => {
  it("filters pages with accent-insensitive matching", async () => {
    useWorkspaceStore.setState({
      pages: [
        { title: "Café Notes", relative_path: "Café Notes.md", frontmatter: {}, created_at: 1000, modified_at: 1000, file_type: 'markdown' as const, has_companion: false },
        { title: "Other", relative_path: "Other.md", frontmatter: {}, created_at: 1000, modified_at: 1000, file_type: 'markdown' as const, has_companion: false },
      ],
    });

    const user = userEvent.setup();
    render(<Sidebar />);

    await user.type(screen.getByLabelText("Search pages"), "cafe");

    expect(screen.getByText("Café Notes")).toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });

  it("filters pages matching diacritics like ü to u", async () => {
    useWorkspaceStore.setState({
      pages: [
        { title: "Über alles", relative_path: "Über alles.md", frontmatter: {}, created_at: 1000, modified_at: 1000, file_type: 'markdown' as const, has_companion: false },
      ],
    });

    const user = userEvent.setup();
    render(<Sidebar />);

    await user.type(screen.getByLabelText("Search pages"), "uber");

    expect(screen.getByText("Über alles")).toBeInTheDocument();
  });
});

describe("Sidebar context menu during search", () => {
  it("context menu interaction does not break active search filter", async () => {
    useWorkspaceStore.setState({
      pages: [
        { title: "Café Notes", relative_path: "Café Notes.md", frontmatter: {}, created_at: 1000, modified_at: 1000, file_type: 'markdown' as const, has_companion: false },
        { title: "Other", relative_path: "Other.md", frontmatter: {}, created_at: 1000, modified_at: 1000, file_type: 'markdown' as const, has_companion: false },
      ],
    });

    const user = userEvent.setup();
    render(<Sidebar />);

    await user.type(screen.getByLabelText("Search pages"), "cafe");
    expect(screen.getByText("Café Notes")).toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Café Notes") });

    const call = invokedCommands.find((c) => c.cmd === "show_sidebar_context_menu");
    expect(call).toBeTruthy();

    expect(screen.getByText("Café Notes")).toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });
});

function makePage(title: string, relativePath?: string, fileType: 'markdown' | 'pdf' = 'markdown', hasCompanion = false) {
  return {
    title,
    relative_path: relativePath ?? `${title}.md`,
    frontmatter: {},
    created_at: 1000,
    modified_at: 1000,
    file_type: fileType,
    has_companion: hasCompanion,
  };
}

describe("Sidebar PDF icon", () => {
  it("renders PDF icon with nerd-font class for PDF files", () => {
    useWorkspaceStore.setState({
      pages: [makePage("paper", "paper.pdf", "pdf")],
    });

    render(<Sidebar />);
    const icon = screen.getByLabelText("PDF file");
    expect(icon).toBeInTheDocument();
    expect(icon.classList.contains("nerd-font")).toBe(true);
  });

  it("does not render PDF icon for markdown files", () => {
    useWorkspaceStore.setState({
      pages: [makePage("notes", "notes.md", "markdown")],
    });

    render(<Sidebar />);
    expect(screen.queryByLabelText("PDF file")).not.toBeInTheDocument();
  });
});

describe("Sidebar width constant", () => {
  it("aside element has width set to SIDEBAR_WIDTH_PX", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
    });
    render(<Sidebar />);

    const aside = document.querySelector("aside")!;
    expect(aside.style.width).toBe(`${SIDEBAR_WIDTH_PX}px`);
  });
});

describe("Sidebar scroll layout", () => {
  it("aside element has h-full to constrain scroll container height", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
    });
    render(<Sidebar />);

    const aside = document.querySelector("aside")!;
    expect(aside.className).toContain("h-full");
  });

  it("scroll container has required layout classes for constrained overflow", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
    });
    render(<Sidebar />);

    const scrollContainer = screen.getByTestId("sidebar-file-list");
    expect(scrollContainer.className).toContain("overflow-y-auto");
    expect(scrollContainer.className).toContain("overscroll-contain");
    expect(scrollContainer.className).toContain("flex-1");
  });
});

describe("Sidebar virtualization", () => {
  it("renders page items via virtualized list", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha"), makePage("Beta"), makePage("Gamma")],
    });

    render(<Sidebar />);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("has a scroll container with data-testid sidebar-file-list", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha")],
    });

    render(<Sidebar />);

    expect(screen.getByTestId("sidebar-file-list")).toBeInTheDocument();
  });

  it("culls DOM nodes when scroll container is small and list is large", () => {
    const pages = Array.from({ length: 500 }, (_, i) => makePage(`Page ${i}`, `page-${i}.md`));
    useWorkspaceStore.setState({ pages });

    const origGet = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight")!.get!;
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        if (this.dataset?.testid === "sidebar-file-list") return 200;
        return origGet.call(this);
      },
    });

    try {
      render(<Sidebar />);

      const scrollContainer = screen.getByTestId("sidebar-file-list");
      const renderedItems = scrollContainer.querySelectorAll("[data-index]");
      expect(renderedItems.length).toBeLessThan(100);
      expect(renderedItems.length).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get: origGet,
      });
    }
  });

  it("folder collapse hides children from DOM", async () => {
    useWorkspaceStore.setState({
      pages: [
        makePage("Inside Doc", "docs/inside.md"),
        makePage("Outside", "outside.md"),
      ],
    });

    const user = userEvent.setup();
    render(<Sidebar />);

    expect(screen.queryByText("Inside Doc")).not.toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("Outside")).toBeInTheDocument();

    await user.click(screen.getByText("docs"));

    expect(screen.getByText("Inside Doc")).toBeInTheDocument();
  });

  it("context menu calls invoke with show_sidebar_context_menu", async () => {
    useWorkspaceStore.setState({
      pages: [makePage("Notes", "Notes.md")],
    });

    const user = userEvent.setup();
    render(<Sidebar />);

    const pageButton = screen.getByText("Notes");
    await user.pointer({ keys: "[MouseRight]", target: pageButton });

    const call = invokedCommands.find((c) => c.cmd === "show_sidebar_context_menu");
    expect(call).toBeTruthy();
    expect(call!.args).toEqual({ relativePath: "Notes.md", selectionCount: 1 });
  });
});

describe("Sidebar row focus", () => {
  it("clicking a page row moves DOM focus to the tree container", async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({
      pages: [makePage("Notes", "Notes.md")],
    });

    render(<Sidebar />);

    await user.click(screen.getByText("Notes"));

    expect(document.activeElement).toBe(screen.getByTestId("sidebar-file-list"));
  });

  it("clicking the inline rename input keeps focus in the input", async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({
      pages: [makePage("Notes", "Notes.md")],
    });

    render(<Sidebar />);

    act(() => {
      emitMockEvent("context-menu://sidebar/rename", { relative_path: "Notes.md" });
    });

    const input = screen.getByDisplayValue("Notes");
    await user.click(input);

    expect(document.activeElement).toBe(input);
    expect(document.activeElement).not.toBe(screen.getByTestId("sidebar-file-list"));
  });
});

describe("Sidebar context menu events", () => {
  it("rename event triggers inline rename mode", async () => {
    useWorkspaceStore.setState({
      pages: [makePage("Notes", "Notes.md")],
    });

    render(<Sidebar />);

    act(() => {
      emitMockEvent("context-menu://sidebar/rename", { relative_path: "Notes.md" });
    });

    expect(screen.getByDisplayValue("Notes")).toBeInTheDocument();
  });

  it("inline rename failure shows an error toast and leaves the tree unchanged", async () => {
    const rename = vi.fn(async () => {
      throw new Error("Page already exists: NewNotes.md");
    });
    useWorkspaceStore.setState({
      pages: [makePage("Notes", "Notes.md")],
      renamePage: rename,
    });
    useStatusMessageStore.setState({ message: null, variant: "success", action: null });

    render(<Sidebar />);

    act(() => {
      emitMockEvent("context-menu://sidebar/rename", { relative_path: "Notes.md" });
    });

    const input = screen.getByDisplayValue("Notes");
    await userEvent.clear(input);
    await userEvent.type(input, "NewNotes");
    await act(async () => {
      input.blur();
    });

    await waitFor(() => {
      expect(rename).toHaveBeenCalledWith("Notes.md", "NewNotes");
    });
    expect(useStatusMessageStore.getState().message).toMatch(/already exists/i);
    expect(useStatusMessageStore.getState().variant).toBe("error");
    expect(useWorkspaceStore.getState().pages[0]!.title).toBe("Notes");
    expect(useWorkspaceStore.getState().pages[0]!.relative_path).toBe("Notes.md");
  });

  it("external-editor event calls open_in_external_editor", async () => {
    useWorkspaceStore.setState({
      pages: [makePage("Notes", "Notes.md")],
    });

    render(<Sidebar />);

    act(() => {
      emitMockEvent("context-menu://sidebar/external-editor", { relative_path: "Notes.md" });
    });

    const call = invokedCommands.find((c) => c.cmd === "open_in_external_editor");
    expect(call).toBeTruthy();
    expect(call!.args).toEqual({ relativePath: "Notes.md", line: 1, col: 1 });
  });

  it("export-network event calls onExportNetwork prop", async () => {
    const onExportNetwork = vi.fn();
    useWorkspaceStore.setState({
      pages: [makePage("Notes", "Notes.md")],
    });

    render(<Sidebar onExportNetwork={onExportNetwork} />);

    act(() => {
      emitMockEvent("context-menu://sidebar/export-network", { relative_path: "Notes.md" });
    });

    expect(onExportNetwork).toHaveBeenCalledWith("Notes.md");
  });

  it("trash event calls deletePage", async () => {
    const deletePage = vi.fn();
    useWorkspaceStore.setState({
      pages: [makePage("Notes", "Notes.md")],
      deletePage,
    });

    render(<Sidebar />);

    act(() => {
      emitMockEvent("context-menu://sidebar/trash", { relative_path: "Notes.md" });
    });

    expect(deletePage).toHaveBeenCalledWith("Notes.md");
  });
});

describe("Sidebar sorting", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sort button is visible in sidebar header", () => {
    render(<Sidebar />);
    expect(screen.getByRole("button", { name: "Sort files" })).toBeInTheDocument();
  });

  it("pages sorted by title A-Z by default", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Zebra"), makePage("Apple"), makePage("Mango")],
    });
    render(<Sidebar />);
    const list = screen.getByTestId("sidebar-file-list");
    const items = Array.from(list.querySelectorAll("[data-index]"));
    const titles = items.map((el) => el.textContent);
    expect(titles).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("sorting applies to search-filtered results", async () => {
    useWorkspaceStore.setState({
      pages: [
        makePage("Zebra Note"),
        makePage("Apple Note"),
        makePage("Other"),
      ],
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.type(screen.getByLabelText("Search pages"), "Note");
    const list = screen.getByTestId("sidebar-file-list");
    const items = Array.from(list.querySelectorAll("[data-index]"));
    const titles = items.map((el) => el.textContent);
    expect(titles).toEqual(["Apple Note", "Zebra Note"]);
  });

  it("folders remain alphabetical when sorting by modified time", async () => {
    useWorkspaceStore.setState({
      pages: [
        { ...makePage("Inside", "zebra-folder/inside.md"), modified_at: 1000 },
        { ...makePage("Doc", "alpha-folder/doc.md"), modified_at: 2000 },
      ],
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByRole("button", { name: "Sort files" }));
    await user.click(screen.getByText("Modified time"));

    const list = screen.getByTestId("sidebar-file-list");
    const items = Array.from(list.querySelectorAll("[data-index]"));
    const texts = items.map((el) => el.textContent?.replace(/[▾▸]/, "").trim());
    expect(texts.indexOf("alpha-folder")).toBeLessThan(texts.indexOf("zebra-folder"));
  });

  it("sort preference persists across remounts via localStorage", async () => {
    useWorkspaceStore.setState({
      pages: [
        { ...makePage("Old"), modified_at: 1000 },
        { ...makePage("New"), modified_at: 2000 },
      ],
    });
    const user = userEvent.setup();

    const { unmount } = render(<Sidebar />);
    await user.click(screen.getByRole("button", { name: "Sort files" }));
    await user.click(screen.getByText("Modified time"));
    unmount();

    render(<Sidebar />);
    const list = screen.getByTestId("sidebar-file-list");
    const items = Array.from(list.querySelectorAll("[data-index]"));
    const titles = items.map((el) => el.textContent);
    expect(titles).toEqual(["New", "Old"]);
  });

  it("re-clicking active sort criterion toggles direction", async () => {
    useWorkspaceStore.setState({
      pages: [makePage("Apple"), makePage("Zebra")],
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByRole("button", { name: "Sort files" }));
    await user.click(screen.getByText("File name"));

    const list = screen.getByTestId("sidebar-file-list");
    const items = Array.from(list.querySelectorAll("[data-index]"));
    const titles = items.map((el) => el.textContent);
    expect(titles).toEqual(["Zebra", "Apple"]);
  });
});

function makeBibEntry(overrides: Partial<BibEntry> = {}): BibEntry {
  return {
    key: "k1",
    authors: ["Doe, Jane"],
    title: "Persisted Ref",
    year: "2020",
    entry_type: "article",
    line_number: 1,
    bib_file: "/workspace/r.bib",
    ...overrides,
  };
}

function countBibScans(): number {
  return invokedCommands.filter((c) => c.cmd === "list_bib_entries").length;
}

describe("Sidebar references panel persistence", () => {
  it("does not re-scan bib entries when switching away and back to References", async () => {
    referenceFixture = [makeBibEntry()];
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByRole("button", { name: "References" }));
    await screen.findByText("Persisted Ref");
    const before = countBibScans();
    expect(before).toBe(1);

    await user.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByLabelText("Search pages")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "References" }));
    expect(countBibScans()).toBe(before);
  });

  it("preserves expanded entry state across tab switches", async () => {
    referenceFixture = [makeBibEntry({ year: "2020" })];
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByRole("button", { name: "References" }));
    const title = await screen.findByText("Persisted Ref");
    await user.click(title);
    // expanded detail card shows the year as its own row
    expect(screen.getByText("2020")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByLabelText("Search pages")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "References" }));
    // still expanded after returning
    expect(screen.getByText("2020")).toBeInTheDocument();
  });

  it("keeps the .bib watcher live while another tab is shown", async () => {
    referenceFixture = [makeBibEntry({ title: "Original Title" })];
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByRole("button", { name: "References" }));
    await screen.findByText("Original Title");

    await user.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByLabelText("Search pages")).toBeInTheDocument();

    // mutate fixture and fire a file event while References is hidden
    referenceFixture = [makeBibEntry({ title: "Updated Title" })];
    act(() => {
      emitMockEvent("workspace://file-modified", { path: "/workspace/r.bib" });
    });

    await user.click(screen.getByRole("button", { name: "References" }));
    expect(await screen.findByText("Updated Title")).toBeInTheDocument();
  });

  it("keeps ReferenceLibrary mounted but hidden when on another tab", async () => {
    referenceFixture = [makeBibEntry()];
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByRole("button", { name: "References" }));
    await screen.findByText("Persisted Ref");

    await user.click(screen.getByRole("button", { name: "Files" }));

    const input = screen.queryByLabelText("Search references");
    expect(input).toBeInTheDocument();

    // walk up from the input to the visibility-toggled wrapper
    let node: HTMLElement | null = input as HTMLElement;
    let hiddenWrapper: HTMLElement | null = null;
    while (node) {
      if (node.style.display === "none") {
        hiddenWrapper = node;
        break;
      }
      node = node.parentElement;
    }
    expect(hiddenWrapper).not.toBeNull();
    expect(hiddenWrapper!.style.display).toBe("none");
  });
});

describe("Sidebar companion indicator", () => {
  it("renders companion glyph when has_companion is true", () => {
    useWorkspaceStore.setState({
      pages: [makePage("paper", "paper.md", "markdown", true)],
    });

    render(<Sidebar />);
    expect(screen.getByLabelText("Has companion")).toBeInTheDocument();
  });

  it("does not render companion glyph when has_companion is false", () => {
    useWorkspaceStore.setState({
      pages: [makePage("paper", "paper.md", "markdown", false)],
    });

    render(<Sidebar />);
    expect(screen.queryByLabelText("Has companion")).not.toBeInTheDocument();
  });

  it("renders companion glyph for PDF files with companion", () => {
    useWorkspaceStore.setState({
      pages: [makePage("paper", "paper.pdf", "pdf", true)],
    });

    render(<Sidebar />);
    expect(screen.getByLabelText("Has companion")).toBeInTheDocument();
  });

  it("companion glyph click calls executeCommand", async () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({
      pages: [makePage("paper", "paper.md", "markdown", true)],
      selectPage,
    });

    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByLabelText("Has companion"));
    expect(selectPage).toHaveBeenCalledWith("paper.md");
  });
});

describe("Sidebar ARIA tree attributes", () => {
  it("tree container has role=tree, aria-label, and tabIndex=0", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
    });
    render(<Sidebar />);
    const tree = screen.getByRole("tree", { name: "File tree" });
    expect(tree).toBeInTheDocument();
    expect(tree.tabIndex).toBe(0);
  });

  it("folder rows have role=treeitem and aria-expanded", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Inside", "docs/inside.md")],
    });
    render(<Sidebar />);
    const treeItems = screen.getAllByRole("treeitem");
    const folderItem = treeItems.find((el) => el.getAttribute("aria-expanded") !== null);
    expect(folderItem).toBeTruthy();
    expect(folderItem!.getAttribute("aria-expanded")).toBe("false");
  });

  it("page items have role=treeitem with aria-level and aria-selected", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha"), makePage("Beta")],
      currentPagePath: "Alpha.md",
    });
    useFileTreeSelectionStore.getState().setOnly("Alpha.md");
    render(<Sidebar />);
    const treeItems = screen.getAllByRole("treeitem");
    expect(treeItems.length).toBe(2);
    const selected = treeItems.filter((el) => el.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(treeItems[0]!.getAttribute("aria-level")).toBe("1");
  });

  it("nested page has aria-level=2", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Inside", "docs/inside.md")],
    });
    render(<Sidebar />);
    const treeItems = screen.getAllByRole("treeitem");
    const folder = treeItems.find((el) => el.getAttribute("aria-expanded") !== null);
    expect(folder!.getAttribute("aria-level")).toBe("1");
  });

  it("all rendered treeitems have an id starting with tree-item-", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha"), makePage("Beta")],
    });
    render(<Sidebar />);
    const treeItems = screen.getAllByRole("treeitem");
    for (const item of treeItems) {
      expect(item.id).toMatch(/^tree-item-/);
    }
  });

  it("tree container has no aria-activedescendant before any interaction", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha")],
    });
    render(<Sidebar />);
    const tree = screen.getByRole("tree", { name: "File tree" });
    expect(tree.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("clicking a row sets aria-activedescendant to the clicked treeitem id", async () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha"), makePage("Beta")],
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("Beta"));

    const tree = screen.getByRole("tree", { name: "File tree" });
    const betaItem = screen.getAllByRole("treeitem").find((el) => el.textContent === "Beta");
    expect(tree.getAttribute("aria-activedescendant")).toBe(betaItem!.id);
  });
});

describe("Sidebar reveal and search interaction", () => {
  it("auto-reveal does not clear the search filter when the active page matches the filter", async () => {
    const { usePreferencesStore } = await import("../stores/preferences");
    useWorkspaceStore.setState({
      pages: [
        makePage("Alpha Note", "Alpha Note.md"),
        makePage("Beta Note", "Beta Note.md"),
        makePage("Other", "Other.md"),
      ],
      currentPagePath: null,
    });
    usePreferencesStore.setState({ autoRevealInSidebar: true, sidebarVisible: true });

    const user = userEvent.setup();
    render(<Sidebar />);

    // Type a filter
    await user.type(screen.getByLabelText("Search pages"), "Note");

    // Verify filter is applied
    expect(screen.getByText("Alpha Note")).toBeInTheDocument();
    expect(screen.getByText("Beta Note")).toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();

    // Switch to a page that matches the filter -- auto-reveal fires
    act(() => {
      useWorkspaceStore.setState({ currentPagePath: "Beta Note.md" });
    });

    // Search should still be "Note" -- not cleared
    expect(screen.getByLabelText("Search pages")).toHaveValue("Note");
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
    expect(screen.getByText("Beta Note")).toBeInTheDocument();
  });

  it("auto-reveal skips when the active page is filtered out, preserving search", async () => {
    const { usePreferencesStore } = await import("../stores/preferences");
    useWorkspaceStore.setState({
      pages: [
        makePage("Alpha Note", "Alpha Note.md"),
        makePage("Beta Note", "Beta Note.md"),
        makePage("Other", "Other.md"),
      ],
      currentPagePath: null,
    });
    usePreferencesStore.setState({ autoRevealInSidebar: true, sidebarVisible: true });

    const user = userEvent.setup();
    render(<Sidebar />);

    // Type a filter
    await user.type(screen.getByLabelText("Search pages"), "Alpha");

    // Verify filter is applied
    expect(screen.getByText("Alpha Note")).toBeInTheDocument();
    expect(screen.queryByText("Beta Note")).not.toBeInTheDocument();

    // Switch to a page that does NOT match the filter
    act(() => {
      useWorkspaceStore.setState({ currentPagePath: "Beta Note.md" });
    });

    // Search should still be "Alpha" -- not cleared
    expect(screen.getByLabelText("Search pages")).toHaveValue("Alpha");
    expect(screen.getByText("Alpha Note")).toBeInTheDocument();
    expect(screen.queryByText("Beta Note")).not.toBeInTheDocument();
  });

  it("manual reveal clears search when the target page is filtered out", async () => {
    useWorkspaceStore.setState({
      pages: [
        makePage("Alpha Note", "Alpha Note.md"),
        makePage("Beta Note", "Beta Note.md"),
        makePage("Other", "Other.md"),
      ],
    });

    const user = userEvent.setup();
    render(<Sidebar />);

    // Type a filter that excludes "Beta Note"
    await user.type(screen.getByLabelText("Search pages"), "Alpha");
    expect(screen.queryByText("Beta Note")).not.toBeInTheDocument();

    // Manual reveal for a filtered-out page
    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:reveal-in-file-tree", { detail: { relativePath: "Beta Note.md" } }),
      );
    });

    // Search should be cleared so Beta Note becomes visible
    expect(screen.getByLabelText("Search pages")).toHaveValue("");
    expect(screen.getByText("Beta Note")).toBeInTheDocument();
  });

  it("auto-reveal does not switch tabs while a non-files tab is active", async () => {
    const { usePreferencesStore } = await import("../stores/preferences");
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
      currentPagePath: null,
    });
    usePreferencesStore.setState({ autoRevealInSidebar: true, sidebarVisible: true });

    const user = userEvent.setup();
    render(<Sidebar />);

    // Switch to the Outline tab
    await user.click(screen.getByRole("button", { name: "Outline" }));

    // Verify outline is shown and search input is absent
    expect(screen.getByText("No page selected")).toBeInTheDocument();
    expect(screen.queryByLabelText("Search pages")).not.toBeInTheDocument();

    // Trigger auto-reveal by setting currentPagePath (with outline content)
    act(() => {
      useWorkspaceStore.setState({
        currentPagePath: "Alpha.md",
        currentPageHeadings: [{ level: 1, text: "Intro", line: 1, from: 0, to: 6 }],
      });
    });

    // Auto-reveal must NOT yank the user to the files tab
    expect(screen.queryByLabelText("Search pages")).not.toBeInTheDocument();
    expect(screen.getByText("Intro")).toBeInTheDocument();
  });

  it("auto-reveal does not switch tabs while the References tab is active", async () => {
    const { usePreferencesStore } = await import("../stores/preferences");
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
      currentPagePath: null,
    });
    usePreferencesStore.setState({ autoRevealInSidebar: true, sidebarVisible: true });

    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByRole("button", { name: "References" }));
    expect(await screen.findByText(/No references found/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Search pages")).not.toBeInTheDocument();

    act(() => {
      // Simulates Open note / Open PDF / materialize / OCR completion, etc.
      useWorkspaceStore.setState({ currentPagePath: "Alpha.md" });
    });

    expect(screen.queryByLabelText("Search pages")).not.toBeInTheDocument();
    expect(screen.getByText(/No references found/i)).toBeInTheDocument();
  });

  it("auto-reveal expands and flashes the active file while the Files tab is active", async () => {
    vi.useFakeTimers();
    try {
      const { usePreferencesStore } = await import("../stores/preferences");
      useWorkspaceStore.setState({
        pages: [
          makePage("Nested", "docs/Nested.md"),
          makePage("Outside", "Outside.md"),
        ],
        currentPagePath: null,
      });
      usePreferencesStore.setState({ autoRevealInSidebar: true, sidebarVisible: true });

      render(<Sidebar />);

      // Files tab is default; Nested is under a collapsed folder initially
      expect(screen.getByText("docs")).toBeInTheDocument();
      expect(screen.queryByText("Nested")).not.toBeInTheDocument();

      act(() => {
        useWorkspaceStore.setState({ currentPagePath: "docs/Nested.md" });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Ancestors expanded + row visible
      expect(screen.getByText("Nested")).toBeInTheDocument();
      // Flash class applied via useRevealFlash
      const rowButton = screen.getByText("Nested").closest("button");
      expect(rowButton?.className).toMatch(/sidebar-item-revealed/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-reveal does not switch tabs while the search tab is active", async () => {
    const { usePreferencesStore } = await import("../stores/preferences");
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
      currentPagePath: null,
      graphReady: false,
    });
    usePreferencesStore.setState({ autoRevealInSidebar: true, sidebarVisible: true });

    const user = userEvent.setup();
    render(<Sidebar />);

    // Switch to the Search tab (global search panel)
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.queryByLabelText("Search pages")).not.toBeInTheDocument();

    // Navigating (e.g. clicking a search result) changes currentPagePath
    act(() => {
      useWorkspaceStore.setState({ currentPagePath: "Alpha.md" });
    });

    // Auto-reveal must NOT yank the user back to the files tab
    expect(screen.queryByLabelText("Search pages")).not.toBeInTheDocument();

    localStorage.removeItem("lit-sidebar-tab");
  });

  it("manual reveal switches to files tab when on a non-files tab", async () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
      currentPagePath: null,
    });

    const user = userEvent.setup();
    render(<Sidebar />);

    // Switch to the Outline tab
    await user.click(screen.getByRole("button", { name: "Outline" }));

    // Verify outline is shown and search input is absent
    expect(screen.getByText("No page selected")).toBeInTheDocument();
    expect(screen.queryByLabelText("Search pages")).not.toBeInTheDocument();

    // Dispatch manual reveal event
    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:reveal-in-file-tree", { detail: { relativePath: "Alpha.md" } }),
      );
    });

    // Manual reveal should switch to the files tab
    expect(screen.getByLabelText("Search pages")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    // Outline-specific content should no longer be shown
    expect(screen.queryByText("No page selected")).not.toBeInTheDocument();
  });

  it("manual reveal expands collapsed parent folder", async () => {
    useWorkspaceStore.setState({
      pages: [
        makePage("Nested", "docs/Nested.md"),
        makePage("Outside", "Outside.md"),
      ],
    });

    render(<Sidebar />);

    // Folder starts collapsed — Nested is not visible
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.queryByText("Nested")).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:reveal-in-file-tree", { detail: { relativePath: "docs/Nested.md" } }),
      );
    });

    // Parent folder should expand and file should become visible
    expect(screen.getByText("Nested")).toBeInTheDocument();
  });

  it("manual reveal expands deeply nested collapsed folders", async () => {
    useWorkspaceStore.setState({
      pages: [
        makePage("Deep", "a/b/Deep.md"),
        makePage("Outside", "Outside.md"),
      ],
    });

    render(<Sidebar />);

    // Top-level folder starts collapsed — nested file is not visible
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.queryByText("Deep")).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:reveal-in-file-tree", { detail: { relativePath: "a/b/Deep.md" } }),
      );
    });

    // All ancestor folders should expand and file should become visible
    expect(screen.getByText("Deep")).toBeInTheDocument();
  });

  it("manual reveal with active search + collapsed parent (file matches filter)", async () => {
    useWorkspaceStore.setState({
      pages: [
        makePage("Nested", "docs/Nested.md"),
        makePage("Outside", "Outside.md"),
      ],
    });

    const user = userEvent.setup();
    render(<Sidebar />);

    // Type a filter that matches the nested file
    await user.type(screen.getByLabelText("Search pages"), "Nested");
    expect(screen.queryByText("Outside")).not.toBeInTheDocument();

    // The file matches the filter but is behind a collapsed folder —
    // dispatch reveal
    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:reveal-in-file-tree", { detail: { relativePath: "docs/Nested.md" } }),
      );
    });

    // Search should be preserved and file should become visible
    expect(screen.getByLabelText("Search pages")).toHaveValue("Nested");
    expect(screen.getByText("Nested")).toBeInTheDocument();
  });

  it("manual reveal preserves search when the target page matches the filter", async () => {
    useWorkspaceStore.setState({
      pages: [
        makePage("Alpha Note", "Alpha Note.md"),
        makePage("Beta Note", "Beta Note.md"),
        makePage("Other", "Other.md"),
      ],
    });

    const user = userEvent.setup();
    render(<Sidebar />);

    // Type a filter that includes "Beta Note"
    await user.type(screen.getByLabelText("Search pages"), "Note");
    expect(screen.getByText("Alpha Note")).toBeInTheDocument();
    expect(screen.getByText("Beta Note")).toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();

    // Manual reveal for a page that IS in the filtered list
    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:reveal-in-file-tree", { detail: { relativePath: "Beta Note.md" } }),
      );
    });

    // Search should still be "Note" -- not cleared
    expect(screen.getByLabelText("Search pages")).toHaveValue("Note");
    expect(screen.getByText("Beta Note")).toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });
});

describe("Files tree selection", () => {
  function treeItemByText(text: string): HTMLElement {
    const items = screen.getAllByRole("treeitem");
    const found = items.find((el) => el.textContent === text);
    if (!found) throw new Error(`no treeitem with text ${text}`);
    return found;
  }

  function selectedCount(): number {
    return screen
      .getAllByRole("treeitem")
      .filter((el) => el.getAttribute("aria-selected") === "true").length;
  }

  it("plain click selects and opens the page", async () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md"), makePage("C", "C.md")],
      selectPage,
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));

    expect(selectPage).toHaveBeenCalledWith("A.md");
    expect(treeItemByText("A").getAttribute("aria-selected")).toBe("true");
    expect(selectedCount()).toBe(1);
  });

  it("cmd-click toggles selection without opening", async () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md"), makePage("C", "C.md")],
      selectPage,
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    expect(selectPage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("B"), { metaKey: true });

    expect(selectPage).toHaveBeenCalledTimes(1);
    expect(treeItemByText("A").getAttribute("aria-selected")).toBe("true");
    expect(treeItemByText("B").getAttribute("aria-selected")).toBe("true");
  });

  it("ctrl-click toggles selection like meta", async () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md")],
      selectPage,
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    fireEvent.click(screen.getByText("B"), { ctrlKey: true });

    expect(selectPage).toHaveBeenCalledTimes(1);
    expect(treeItemByText("A").getAttribute("aria-selected")).toBe("true");
    expect(treeItemByText("B").getAttribute("aria-selected")).toBe("true");
  });

  it("cmd-click on an already selected page deselects it", async () => {
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md")],
      selectPage: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    expect(treeItemByText("A").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByText("A"), { metaKey: true });
    expect(treeItemByText("A").getAttribute("aria-selected")).toBe("false");
  });

  it("shift-click range-selects from the anchor without opening intermediate pages", async () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md"), makePage("C", "C.md")],
      selectPage,
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    expect(selectPage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("C"), { shiftKey: true });

    expect(selectPage).toHaveBeenCalledTimes(1);
    expect(treeItemByText("A").getAttribute("aria-selected")).toBe("true");
    expect(treeItemByText("B").getAttribute("aria-selected")).toBe("true");
    expect(treeItemByText("C").getAttribute("aria-selected")).toBe("true");
  });

  it("selected non-active row gets a distinct selected class", async () => {
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md")],
      currentPagePath: null,
      selectPage: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));

    const btnA = screen.getByText("A");
    expect(btnA.classList.contains("bg-bg-hover")).toBe(true);
    expect(btnA.classList.contains("bg-nav-active-bg")).toBe(false);
  });

  it("plain click after multi-selection reduces to one and opens", async () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md"), makePage("C", "C.md")],
      selectPage,
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    fireEvent.click(screen.getByText("C"), { metaKey: true });
    expect(selectedCount()).toBe(2);

    await user.click(screen.getByText("B"));

    expect(selectedCount()).toBe(1);
    expect(treeItemByText("B").getAttribute("aria-selected")).toBe("true");
    expect(selectPage).toHaveBeenCalledWith("B.md");
  });
});

describe("Files tree keyboard selection", () => {
  function tree(): HTMLElement {
    return screen.getByTestId("sidebar-file-list");
  }

  function selectedCount(): number {
    return screen
      .getAllByRole("treeitem")
      .filter((el) => el.getAttribute("aria-selected") === "true").length;
  }

  it("Escape clears the multi-selection", async () => {
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md"), makePage("C", "C.md")],
      selectPage: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    fireEvent.click(screen.getByText("B"), { metaKey: true });
    expect(selectedCount()).toBe(2);

    fireEvent.keyDown(tree(), { key: "Escape" });

    expect(selectedCount()).toBe(0);
  });

  it("Space toggles the focused page in the selection without opening", async () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md")],
      selectPage,
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    expect(selectPage).toHaveBeenCalledTimes(1);

    // Move focus to B via ArrowDown, then Space toggles B in.
    fireEvent.keyDown(tree(), { key: "ArrowDown" });
    fireEvent.keyDown(tree(), { key: " " });

    expect(selectPage).toHaveBeenCalledTimes(1);
    const sel = useFileTreeSelectionStore.getState().selectedPaths;
    expect([...sel].sort()).toEqual(["A.md", "B.md"]);
  });

  it("Mod-a selects all visible pages only", async () => {
    useWorkspaceStore.setState({
      pages: [
        makePage("A", "A.md"),
        makePage("B", "B.md"),
        makePage("C", "C.md"),
        makePage("Nested", "docs/Nested.md"),
      ],
      selectPage: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    // docs folder starts collapsed; Nested is not rendered.
    expect(screen.queryByText("Nested")).not.toBeInTheDocument();

    await user.click(screen.getByText("A"));
    fireEvent.keyDown(tree(), { key: "a", metaKey: true });

    expect(selectedCount()).toBe(3);
    const sel = useFileTreeSelectionStore.getState().selectedPaths;
    expect([...sel].sort()).toEqual(["A.md", "B.md", "C.md"]);
  });

  it("F2 on the focused page starts inline rename", async () => {
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md")],
      selectPage: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    fireEvent.keyDown(tree(), { key: "F2" });

    expect(screen.getByDisplayValue("A")).toBeInTheDocument();
  });
});

describe("Files tree trash", () => {
  function tree(): HTMLElement {
    return screen.getByTestId("sidebar-file-list");
  }

  it("Delete on a single selected page trashes it without a dialog", async () => {
    const deletePage = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md")],
      deletePage,
      selectPage: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    fireEvent.keyDown(tree(), { key: "Delete" });

    expect(deletePage).toHaveBeenCalledTimes(1);
    expect(deletePage).toHaveBeenCalledWith("A.md");
    expect(screen.queryByTestId("confirm-delete-dialog")).not.toBeInTheDocument();
  });

  it("Backspace with a focused page and empty selection trashes that page", async () => {
    const deletePage = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md")],
      deletePage,
      selectPage: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    useFileTreeSelectionStore.getState().clear();
    fireEvent.keyDown(tree(), { key: "Backspace" });

    expect(deletePage).toHaveBeenCalledWith("A.md");
  });

  it("Delete on a focused folder with empty selection does nothing", async () => {
    const deletePage = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      pages: [makePage("Inside", "docs/Inside.md"), makePage("Outside", "Outside.md")],
      deletePage,
      selectPage: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("docs"));
    fireEvent.keyDown(tree(), { key: "Delete" });

    expect(deletePage).not.toHaveBeenCalled();
  });

  it("Delete while the rename input is focused does not trash", async () => {
    const deletePage = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md")],
      deletePage,
      selectPage: vi.fn(),
    });
    render(<Sidebar />);

    act(() => {
      emitMockEvent("context-menu://sidebar/rename", { relative_path: "A.md" });
    });

    const input = screen.getByDisplayValue("A");
    fireEvent.keyDown(input, { key: "Delete" });

    expect(deletePage).not.toHaveBeenCalled();
  });
});

describe("Files tree multi trash confirm", () => {
  function tree(): HTMLElement {
    return screen.getByTestId("sidebar-file-list");
  }

  it("Delete with a multi-selection shows the confirm dialog first", async () => {
    const deletePage = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md"), makePage("C", "C.md")],
      deletePage,
      selectPage: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    fireEvent.click(screen.getByText("B"), { metaKey: true });
    fireEvent.keyDown(tree(), { key: "Delete" });

    expect(screen.getByTestId("confirm-delete-dialog")).toBeInTheDocument();
    expect(deletePage).not.toHaveBeenCalled();
  });

  it("cancelling the confirm dialog keeps the selection and trashes nothing", async () => {
    const deletePage = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md")],
      deletePage,
      selectPage: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    fireEvent.click(screen.getByText("B"), { metaKey: true });
    fireEvent.keyDown(tree(), { key: "Delete" });
    expect(screen.getByTestId("confirm-delete-dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("confirm-delete-cancel"));

    expect(screen.queryByTestId("confirm-delete-dialog")).not.toBeInTheDocument();
    expect(deletePage).not.toHaveBeenCalled();
    const sel = useFileTreeSelectionStore.getState().selectedPaths;
    expect([...sel].sort()).toEqual(["A.md", "B.md"]);
  });

  it("confirming trashes each selected path and prunes the selection", async () => {
    const deletePage = vi.fn(async (path: string) => {
      useWorkspaceStore.setState((s) => ({
        pages: s.pages.filter((p) => p.relative_path !== path),
      }));
    });
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md"), makePage("C", "C.md")],
      deletePage,
      selectPage: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    fireEvent.click(screen.getByText("B"), { metaKey: true });
    fireEvent.keyDown(tree(), { key: "Delete" });
    expect(screen.getByTestId("confirm-delete-dialog")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-delete-btn"));
    });

    expect(deletePage).toHaveBeenCalledWith("A.md");
    expect(deletePage).toHaveBeenCalledWith("B.md");
    expect(screen.queryByTestId("confirm-delete-dialog")).not.toBeInTheDocument();
    expect([...useFileTreeSelectionStore.getState().selectedPaths]).toEqual([]);
  });

  it("context-menu trash on a path inside a multi-selection shows the dialog", async () => {
    const deletePage = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md"), makePage("C", "C.md")],
      deletePage,
      selectPage: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    fireEvent.click(screen.getByText("B"), { metaKey: true });
    fireEvent.click(screen.getByText("C"), { metaKey: true });
    expect(useFileTreeSelectionStore.getState().selectedPaths.size).toBe(3);

    act(() => {
      emitMockEvent("context-menu://sidebar/trash", { relative_path: "B.md" });
    });

    expect(screen.getByTestId("confirm-delete-dialog")).toBeInTheDocument();
    expect(deletePage).not.toHaveBeenCalled();
  });

  it("context menu passes the multi-selection count for a selected path", async () => {
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md"), makePage("C", "C.md")],
      selectPage: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    fireEvent.click(screen.getByText("B"), { metaKey: true });
    fireEvent.click(screen.getByText("C"), { metaKey: true });

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("B") });

    const call = invokedCommands.find((c) => c.cmd === "show_sidebar_context_menu");
    expect(call).toBeTruthy();
    expect(call!.args).toEqual({ relativePath: "B.md", selectionCount: 3 });
  });
});

describe("Files tree selection lifecycle", () => {
  function selectTwo() {
    useWorkspaceStore.setState({
      pages: [makePage("A", "A.md"), makePage("B", "B.md")],
      selectPage: vi.fn(),
    });
  }

  it("switching away from the Files tab clears the selection", async () => {
    selectTwo();
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    fireEvent.click(screen.getByText("B"), { metaKey: true });
    expect(useFileTreeSelectionStore.getState().selectedPaths.size).toBe(2);

    await user.click(screen.getByRole("button", { name: "Outline" }));
    expect(useFileTreeSelectionStore.getState().selectedPaths.size).toBe(0);

    await user.click(screen.getByRole("button", { name: "Files" }));
    expect(useFileTreeSelectionStore.getState().selectedPaths.size).toBe(0);
  });

  it("changing the workspace clears the selection", async () => {
    useWorkspaceStore.setState({
      workspacePath: "/workspace",
      pages: [makePage("A", "A.md"), makePage("B", "B.md")],
      selectPage: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    fireEvent.click(screen.getByText("B"), { metaKey: true });
    expect(useFileTreeSelectionStore.getState().selectedPaths.size).toBe(2);

    act(() => {
      useWorkspaceStore.setState({ workspacePath: "/other" });
    });

    expect(useFileTreeSelectionStore.getState().selectedPaths.size).toBe(0);
  });

  it("prunes selection when a selected page disappears from pages", async () => {
    selectTwo();
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("A"));
    fireEvent.click(screen.getByText("B"), { metaKey: true });
    expect(useFileTreeSelectionStore.getState().selectedPaths.size).toBe(2);

    act(() => {
      useWorkspaceStore.setState({
        pages: [makePage("A", "A.md")],
      });
    });

    expect([...useFileTreeSelectionStore.getState().selectedPaths]).toEqual(["A.md"]);
  });
});

describe("Files tree trash focus", () => {
  function trashWithState(pages: ReturnType<typeof makePage>[]) {
    const deletePage = vi.fn(async (path: string) => {
      useWorkspaceStore.setState((s) => ({
        pages: s.pages.filter((p) => p.relative_path !== path),
      }));
    });
    useWorkspaceStore.setState({
      pages,
      deletePage,
      selectPage: vi.fn(),
    });
    return deletePage;
  }

  it("moves focus to the next neighbor after trashing the focused page", async () => {
    trashWithState([makePage("A", "A.md"), makePage("B", "B.md"), makePage("C", "C.md")]);
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("B"));
    fireEvent.keyDown(screen.getByTestId("sidebar-file-list"), { key: "Delete" });

    const tree = screen.getByTestId("sidebar-file-list");
    expect(tree.getAttribute("aria-activedescendant")).toBe("tree-item-C.md");
    expect([...useFileTreeSelectionStore.getState().selectedPaths]).toEqual([]);
  });

  it("moves focus to the previous row when the trashed page was last", async () => {
    trashWithState([makePage("A", "A.md"), makePage("B", "B.md"), makePage("C", "C.md")]);
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("C"));
    fireEvent.keyDown(screen.getByTestId("sidebar-file-list"), { key: "Delete" });

    const tree = screen.getByTestId("sidebar-file-list");
    expect(tree.getAttribute("aria-activedescendant")).toBe("tree-item-B.md");
  });
});
