import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { Sidebar } from "./Sidebar";

beforeEach(() => {
  useWorkspaceStore.setState({
    workspacePath: "/workspace",
    pages: [],
    currentPagePath: null,
    loading: false,
    error: null,
  });

  mockInvoke((cmd, args) => {
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
    throw new Error(`Unknown command: ${cmd}`);
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
