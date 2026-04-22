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
        case "get_pending_workspace":
          return null;
        case "list_themes":
          return [];
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

  it("auto-opens workspace from recent workspaces", async () => {
    localStorage.setItem("lit-recent-workspaces", JSON.stringify(["/saved/workspace"]));

    render(<App />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspacePath).toBe("/saved/workspace");
    });
  });

  it("auto-opens workspace from pending workspace", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_pending_workspace":
          return "/pending/workspace";
        case "open_workspace":
          return samplePages;
        case "get_initial_workspace":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    render(<App />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspacePath).toBe("/pending/workspace");
    });
  });

  it("has a theme toggle that switches to dark mode", async () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [] });

    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("View"));
    await user.click(screen.getByText("Dark Mode"));
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
    await user.click(screen.getByText("View"));
    await user.click(screen.getByText("Sidebar Right"));
    const container = screen.getByText("Pages").closest("aside")!.parentElement!;
    expect(container.className).toContain("flex-row-reverse");
  });
});
