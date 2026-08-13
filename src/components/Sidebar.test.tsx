import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, mockListen, emitMockEvent, resetListenMock } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { useStatusMessageStore } from "../stores/statusMessage";
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
    expect(call!.args).toEqual({ relativePath: "Notes.md" });
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

  it("auto-reveal switches to files tab when on a non-files tab", async () => {
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

    // Trigger auto-reveal by setting currentPagePath
    act(() => {
      useWorkspaceStore.setState({ currentPagePath: "Alpha.md" });
    });

    // Auto-reveal should switch to the files tab
    expect(screen.getByLabelText("Search pages")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
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
