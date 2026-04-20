import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { mockInvoke } from "./test/tauri-mock";
import { useWorkspaceStore } from "./stores/workspace";

const samplePages = [
  {
    title: "Test Page",
    relative_path: "Test Page.md",
    frontmatter: {},
    created_at: 1000,
    modified_at: 2000,
  },
];

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("App", () => {
  beforeEach(() => {
    mockMatchMedia(false);
    document.documentElement.classList.remove("dark");
    useWorkspaceStore.setState({
      workspacePath: null,
      pages: [],
      currentPagePath: null,
      loading: false,
      error: null,
    });

    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_app_info":
          return { name: "Lit", version: "0.1.0" };
        case "open_workspace":
          return samplePages;
        case "list_pages":
          return samplePages;
        case "get_initial_workspace":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
  });

  it("shows workspace chooser when no workspace open", () => {
    render(<App />);
    expect(screen.getByText("Open Workspace")).toBeInTheDocument();
  });

  it("shows sidebar and content when workspace is open", async () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      pages: samplePages,
    });

    render(<App />);
    expect(screen.getByText("Pages")).toBeInTheDocument();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("auto-opens workspace from localStorage", async () => {
    localStorage.setItem("lit-workspace-path", "/saved/workspace");

    render(<App />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspacePath).toBe("/saved/workspace");
    });
  });

  it("has a theme toggle that switches to dark mode", async () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [] });

    const user = userEvent.setup();
    render(<App />);
    const toggle = screen.getByLabelText("Switch to dark mode");
    await user.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("renders sidebar on the left by default", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [] });

    render(<App />);
    const container = screen.getByText("Pages").closest("aside")!.parentElement!;
    expect(container.className).toContain("flex-row");
    expect(container.className).not.toContain("flex-row-reverse");
  });

  it("position toggle moves sidebar to the right", async () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [] });

    const user = userEvent.setup();
    render(<App />);
    const toggle = screen.getByLabelText("Move sidebar to right");
    await user.click(toggle);
    const container = screen.getByText("Pages").closest("aside")!.parentElement!;
    expect(container.className).toContain("flex-row-reverse");
  });
});
