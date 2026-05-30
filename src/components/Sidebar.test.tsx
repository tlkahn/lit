import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, mockListen, emitMockEvent, resetListenMock } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { Sidebar, SIDEBAR_WIDTH_PX } from "./Sidebar";

let invokedCommands: { cmd: string; args: unknown }[] = [];

beforeEach(() => {
  invokedCommands = [];
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
    throw new Error(`Unknown command: ${cmd}`);
  });
});

describe("Sidebar tabs", () => {
  it("renders Files and Outline tab buttons", () => {
    render(<Sidebar />);
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("Outline")).toBeInTheDocument();
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

    await user.click(screen.getByText("Outline"));
    expect(screen.getByText("No page selected")).toBeInTheDocument();
    expect(screen.queryByLabelText("Search pages")).not.toBeInTheDocument();

    await user.click(screen.getByText("Files"));
    expect(screen.getByLabelText("Search pages")).toBeInTheDocument();
  });

  it("Files tab shows search + tree; Outline tab shows Outline component", async () => {
    useWorkspaceStore.setState({
      currentPagePath: "test.md",
      currentPageHeadings: [{ level: 1, text: "Hello", line: 0, from: 0, to: 7 }],
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    expect(screen.getByLabelText("Search pages")).toBeInTheDocument();

    await user.click(screen.getByText("Outline"));
    expect(screen.queryByLabelText("Search pages")).not.toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});

describe("Sidebar accent-insensitive filter", () => {
  it("filters pages with accent-insensitive matching", async () => {
    useWorkspaceStore.setState({
      pages: [
        { title: "Café Notes", relative_path: "Café Notes.md", frontmatter: {}, created_at: 1000, modified_at: 1000, file_type: 'markdown' as const },
        { title: "Other", relative_path: "Other.md", frontmatter: {}, created_at: 1000, modified_at: 1000, file_type: 'markdown' as const },
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
        { title: "Über alles", relative_path: "Über alles.md", frontmatter: {}, created_at: 1000, modified_at: 1000, file_type: 'markdown' as const },
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
        { title: "Café Notes", relative_path: "Café Notes.md", frontmatter: {}, created_at: 1000, modified_at: 1000, file_type: 'markdown' as const },
        { title: "Other", relative_path: "Other.md", frontmatter: {}, created_at: 1000, modified_at: 1000, file_type: 'markdown' as const },
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

function makePage(title: string, relativePath?: string, fileType: 'markdown' | 'pdf' = 'markdown') {
  return {
    title,
    relative_path: relativePath ?? `${title}.md`,
    frontmatter: {},
    created_at: 1000,
    modified_at: 1000,
    file_type: fileType,
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
