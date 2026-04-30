import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { Sidebar } from "./Sidebar";

let invokedCommands: { cmd: string; args: unknown }[] = [];

beforeEach(() => {
  invokedCommands = [];
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
    expect(screen.getByRole("button", { name: "New page" })).toBeInTheDocument();
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

describe("Sidebar instant create", () => {
  it("clicking + invokes create_page with 'Untitled' (no prompt)", async () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const user = userEvent.setup();

    render(<Sidebar />);
    await user.click(screen.getByRole("button", { name: "New page" }));

    const state = useWorkspaceStore.getState();
    expect(state.pages).toHaveLength(1);
    expect(state.pages[0]!.title).toBe("Untitled");
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("uses 'Untitled 1' when 'Untitled' exists in store", async () => {
    useWorkspaceStore.setState({
      pages: [
        {
          title: "Untitled",
          relative_path: "Untitled.md",
          frontmatter: {},
          created_at: 1000,
          modified_at: 1000,
          file_type: 'markdown' as const,
        },
      ],
    });

    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(screen.getByRole("button", { name: "New page" }));

    const state = useWorkspaceStore.getState();
    const newPage = state.pages.find((p) => p.title === "Untitled 1");
    expect(newPage).toBeTruthy();
  });

  it("auto-selects the new page after creation", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(screen.getByRole("button", { name: "New page" }));

    expect(useWorkspaceStore.getState().currentPagePath).toBe("Untitled.md");
  });

  it("does not call window.prompt", async () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const user = userEvent.setup();

    render(<Sidebar />);
    await user.click(screen.getByRole("button", { name: "New page" }));

    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
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
    expect(screen.getByText("Rename")).toBeInTheDocument();

    expect(screen.getByText("Café Notes")).toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });
});

describe("Sidebar context menu – Open in External Editor", () => {
  it("right-click shows 'Open in External Editor' button", async () => {
    useWorkspaceStore.setState({
      pages: [
        {
          title: "Notes",
          relative_path: "Notes.md",
          frontmatter: {},
          created_at: 1000,
          modified_at: 1000,
          file_type: 'markdown' as const,
        },
      ],
    });

    const user = userEvent.setup();
    render(<Sidebar />);

    const pageButton = screen.getByText("Notes");
    await user.pointer({ keys: "[MouseRight]", target: pageButton });

    expect(screen.getByText("Open in External Editor")).toBeInTheDocument();
  });

  it("clicking 'Open in External Editor' calls invoke with correct args", async () => {
    useWorkspaceStore.setState({
      pages: [
        {
          title: "Notes",
          relative_path: "Notes.md",
          frontmatter: {},
          created_at: 1000,
          modified_at: 1000,
          file_type: 'markdown' as const,
        },
      ],
    });

    const user = userEvent.setup();
    render(<Sidebar />);

    const pageButton = screen.getByText("Notes");
    await user.pointer({ keys: "[MouseRight]", target: pageButton });
    fireEvent.pointerMove(document);
    await user.click(screen.getByText("Open in External Editor"));

    const call = invokedCommands.find((c) => c.cmd === "open_in_external_editor");
    expect(call).toBeTruthy();
    expect(call!.args).toEqual({ relativePath: "Notes.md", line: 1, col: 1 });
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

    expect(screen.getByText("Inside Doc")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();

    await user.click(screen.getByText("docs"));

    expect(screen.queryByText("Inside Doc")).not.toBeInTheDocument();
    expect(screen.getByText("Outside")).toBeInTheDocument();
  });

  it("context menu still works on virtualized page items", async () => {
    useWorkspaceStore.setState({
      pages: [makePage("Notes", "Notes.md")],
    });

    const user = userEvent.setup();
    render(<Sidebar />);

    const pageButton = screen.getByText("Notes");
    await user.pointer({ keys: "[MouseRight]", target: pageButton });

    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByText("Open in External Editor")).toBeInTheDocument();
  });
});

describe("context menu positioning", () => {
  it("renders at cursor coordinates with fixed positioning", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
    });
    render(<Sidebar />);

    const pageButton = screen.getByText("Alpha");
    fireEvent.contextMenu(pageButton, { clientX: 150, clientY: 200 });

    const menu = screen.getByTestId("context-menu");
    expect(menu.style.position).toBe("fixed");
    expect(menu.style.left).toBe("150px");
    expect(menu.style.top).toBe("200px");
  });

  it("repositions when right-clicking a different item", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md"), makePage("Beta", "Beta.md")],
    });
    render(<Sidebar />);

    fireEvent.contextMenu(screen.getByText("Alpha"), { clientX: 100, clientY: 150 });
    let menu = screen.getByTestId("context-menu");
    expect(menu.style.left).toBe("100px");
    expect(menu.style.top).toBe("150px");

    fireEvent.contextMenu(screen.getByText("Beta"), { clientX: 200, clientY: 300 });
    menu = screen.getByTestId("context-menu");
    expect(menu.style.left).toBe("200px");
    expect(menu.style.top).toBe("300px");
  });
});

describe("context menu viewport clamping", () => {
  it("clamps when menu overflows bottom", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
    });

    const origGetBCR = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.dataset?.testid === "context-menu") {
        return { x: 0, y: 0, width: 120, height: 100, top: 0, left: 0, bottom: 100, right: 120 } as DOMRect;
      }
      return origGetBCR.call(this);
    };

    try {
      render(<Sidebar />);
      fireEvent.contextMenu(screen.getByText("Alpha"), { clientX: 100, clientY: 720 });
      const menu = screen.getByTestId("context-menu");
      expect(parseInt(menu.style.top)).toBeLessThanOrEqual(window.innerHeight - 100);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = origGetBCR;
    }
  });

  it("clamps when menu overflows right", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
    });

    const origGetBCR = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.dataset?.testid === "context-menu") {
        return { x: 0, y: 0, width: 120, height: 100, top: 0, left: 0, bottom: 100, right: 120 } as DOMRect;
      }
      return origGetBCR.call(this);
    };

    try {
      render(<Sidebar />);
      fireEvent.contextMenu(screen.getByText("Alpha"), { clientX: 960, clientY: 200 });
      const menu = screen.getByTestId("context-menu");
      expect(parseInt(menu.style.left)).toBeLessThanOrEqual(window.innerWidth - 120);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = origGetBCR;
    }
  });
});

describe("context menu hover suppression", () => {
  it("has pointer-events:none immediately after opening", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
    });
    render(<Sidebar />);

    fireEvent.contextMenu(screen.getByText("Alpha"), { clientX: 150, clientY: 200 });
    const menu = screen.getByTestId("context-menu");
    expect(menu.style.pointerEvents).toBe("none");
  });

  it("re-enables pointer-events after pointermove", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
    });
    render(<Sidebar />);

    fireEvent.contextMenu(screen.getByText("Alpha"), { clientX: 150, clientY: 200 });
    const menu = screen.getByTestId("context-menu");
    expect(menu.style.pointerEvents).toBe("none");

    fireEvent.pointerMove(document);
    expect(menu.style.pointerEvents).toBe("");
  });

  it("menu items clickable after pointermove", async () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
    });
    render(<Sidebar />);

    fireEvent.contextMenu(screen.getByText("Alpha"), { clientX: 150, clientY: 200 });
    fireEvent.pointerMove(document);

    const user = userEvent.setup();
    await user.click(screen.getByText("Rename"));
    expect(screen.getByDisplayValue("Alpha")).toBeInTheDocument();
  });
});

describe("context menu theme-aware colors", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
    });
  });

  function openMenu() {
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByText("Alpha"), { clientX: 150, clientY: 200 });
  }

  it("normal items use hover:text-text-on-accent, not hover:text-white", () => {
    openMenu();
    const rename = screen.getByText("Rename");
    const openExt = screen.getByText("Open in External Editor");
    for (const btn of [rename, openExt]) {
      expect(btn.className).toContain("hover:text-text-on-accent");
      expect(btn.className).not.toContain("hover:text-white");
    }
  });

  it("Delete uses hover:bg-destructive, not hover:bg-red-500", () => {
    openMenu();
    const del = screen.getByText("Delete");
    expect(del.className).toContain("hover:bg-destructive");
    expect(del.className).not.toContain("hover:bg-red-500");
  });

  it("menu container border uses theme token, not hardcoded white", () => {
    openMenu();
    const menu = screen.getByTestId("context-menu");
    expect(menu.className).toContain("dark:border-border/10");
    expect(menu.className).not.toContain("dark:border-white/10");
  });

  it("separator uses theme border token", () => {
    openMenu();
    const menu = screen.getByTestId("context-menu");
    const sep = menu.querySelector(".border-t");
    expect(sep).toBeTruthy();
    expect(sep!.className).toContain("dark:border-border/10");
    expect(sep!.className).not.toContain("dark:border-white/10");
  });
});

describe("context menu dismissal", () => {
  it("Escape closes the menu", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
    });
    render(<Sidebar />);

    fireEvent.contextMenu(screen.getByText("Alpha"), { clientX: 150, clientY: 200 });
    expect(screen.getByTestId("context-menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("context-menu")).not.toBeInTheDocument();
  });

  it("clicking outside closes the menu", () => {
    useWorkspaceStore.setState({
      pages: [makePage("Alpha", "Alpha.md")],
    });
    render(<Sidebar />);

    fireEvent.contextMenu(screen.getByText("Alpha"), { clientX: 150, clientY: 200 });
    expect(screen.getByTestId("context-menu")).toBeInTheDocument();

    fireEvent.mouseDown(document);
    expect(screen.queryByTestId("context-menu")).not.toBeInTheDocument();
  });
});
