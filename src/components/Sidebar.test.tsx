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
