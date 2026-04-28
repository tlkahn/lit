import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
        { title: "Café Notes", relative_path: "Café Notes.md", frontmatter: {}, created_at: 1000, modified_at: 1000 },
        { title: "Other", relative_path: "Other.md", frontmatter: {}, created_at: 1000, modified_at: 1000 },
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
        { title: "Über alles", relative_path: "Über alles.md", frontmatter: {}, created_at: 1000, modified_at: 1000 },
      ],
    });

    const user = userEvent.setup();
    render(<Sidebar />);

    await user.type(screen.getByLabelText("Search pages"), "uber");

    expect(screen.getByText("Über alles")).toBeInTheDocument();
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
        },
      ],
    });

    const user = userEvent.setup();
    render(<Sidebar />);

    const pageButton = screen.getByText("Notes");
    await user.pointer({ keys: "[MouseRight]", target: pageButton });
    await user.click(screen.getByText("Open in External Editor"));

    const call = invokedCommands.find((c) => c.cmd === "open_in_external_editor");
    expect(call).toBeTruthy();
    expect(call!.args).toEqual({ relativePath: "Notes.md", line: 1, col: 1 });
  });
});

function makePage(title: string, relativePath?: string) {
  return {
    title,
    relative_path: relativePath ?? `${title}.md`,
    frontmatter: {},
    created_at: 1000,
    modified_at: 1000,
  };
}

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
