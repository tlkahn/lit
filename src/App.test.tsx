import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import App from "./App";
import { mockInvoke, mockListen, emitMockEvent } from "./test/tauri-mock";
import { useWorkspaceStore } from "./stores/workspace";
import { usePreferencesStore } from "./stores/preferences";

const samplePages = [
  {
    title: "Test Page",
    relative_path: "Test Page.md",
    frontmatter: {},
    created_at: 1000,
    modified_at: 2000,
  },
];

describe("App", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    useWorkspaceStore.setState({
      workspacePath: null,
      pages: [],
      currentPagePath: null,
      graphReady: false,
      indexProgress: null,
      loading: false,
      error: null,
    });

    usePreferencesStore.setState({
      darkMode: "light",
      colorTheme: null,
      sidebarLocation: "left",
      loaded: true,
    });

    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_app_info":
          return { name: "Lit", version: "0.1.0" };
        case "open_workspace":
          return samplePages;
        case "list_pages":
          return samplePages;
        case "get_startup_context":
          return { workspace: null, file: null, line: null, col: null };
        case "list_themes":
          return [];
        case "get_preferences":
          return {
            "workbench.colorTheme": null,
            "workbench.darkMode": "light",
            "workbench.sideBar.location": "left",
          };
        case "get_keymaps":
          return [];
        case "read_page":
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
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
      graphReady: true,
    });

    render(<App />);
    expect(screen.getByText("Files")).toBeInTheDocument();
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
        case "get_startup_context":
          return { workspace: "/pending/workspace", file: null, line: null, col: null };
        case "open_workspace":
          return samplePages;
        case "get_keymaps":
          return [];
        case "ensure_graph_ready":
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

  it("applies dark mode from preferences", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    usePreferencesStore.setState({ darkMode: "dark" });

    render(<App />);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("renders sidebar on the left by default", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });

    render(<App />);
    const container = screen.getByText("Files").closest("aside")!.parentElement!;
    expect(container.className).toContain("flex-row");
    expect(container.className).not.toContain("flex-row-reverse");
  });

  it("renders sidebar on the right from preferences", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    usePreferencesStore.setState({ sidebarLocation: "right" });

    render(<App />);
    const container = screen.getByText("Files").closest("aside")!.parentElement!;
    expect(container.className).toContain("flex-row-reverse");
  });

  it("quick switcher not visible by default", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    render(<App />);
    expect(screen.queryByTestId("quick-switcher-backdrop")).not.toBeInTheDocument();
  });

  it("dispatching lit:toggle-quick-switcher shows the quick switcher", async () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    render(<App />);

    act(() => {
      window.dispatchEvent(new CustomEvent("lit:toggle-quick-switcher"));
    });

    expect(screen.getByTestId("quick-switcher-backdrop")).toBeInTheDocument();
  });

  it("dispatching lit:toggle-quick-switcher twice hides it", async () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    render(<App />);

    act(() => {
      window.dispatchEvent(new CustomEvent("lit:toggle-quick-switcher"));
    });
    expect(screen.getByTestId("quick-switcher-backdrop")).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent("lit:toggle-quick-switcher"));
    });
    expect(screen.queryByTestId("quick-switcher-backdrop")).not.toBeInTheDocument();
  });

  it("auto-selects initial file after CLI workspace opens", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_startup_context":
          return { workspace: "/cli/workspace", file: "notes.md", line: null, col: null };
        case "open_workspace":
          return samplePages;
        case "list_themes":
          return [];
        case "get_preferences":
          return {
            "workbench.colorTheme": null,
            "workbench.darkMode": "light",
            "workbench.sideBar.location": "left",
          };
        case "get_keymaps":
          return [];
        case "read_page":
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    render(<App />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspacePath).toBe("/cli/workspace");
      expect(useWorkspaceStore.getState().currentPagePath).toBe("notes.md");
    });
  });

  it("does not select file when startup context has no file", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_startup_context":
          return { workspace: "/cli/workspace", file: null, line: null, col: null };
        case "open_workspace":
          return samplePages;
        case "list_themes":
          return [];
        case "get_preferences":
          return {
            "workbench.colorTheme": null,
            "workbench.darkMode": "light",
            "workbench.sideBar.location": "left",
          };
        case "get_keymaps":
          return [];
        case "ensure_graph_ready":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    render(<App />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspacePath).toBe("/cli/workspace");
    });
    expect(useWorkspaceStore.getState().currentPagePath).toBeNull();
  });

  it("auto-selects pending file in second-instance window", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_startup_context":
          return { workspace: "/pending/workspace", file: "readme.md", line: null, col: null };
        case "open_workspace":
          return samplePages;
        case "list_themes":
          return [];
        case "get_preferences":
          return {
            "workbench.colorTheme": null,
            "workbench.darkMode": "light",
            "workbench.sideBar.location": "left",
          };
        case "get_keymaps":
          return [];
        case "read_page":
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    render(<App />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspacePath).toBe("/pending/workspace");
      expect(useWorkspaceStore.getState().currentPagePath).toBe("readme.md");
    });
  });

  it("shows Sidebar and StatusBar when workspace set but graphReady is false", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: false });
    render(<App />);
    expect(screen.queryByTestId("indexing-screen")).not.toBeInTheDocument();
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByTestId("status-bar")).toBeInTheDocument();
  });

  it("shows Sidebar without StatusBar when workspace set and graphReady is true", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    render(<App />);
    expect(screen.queryByTestId("indexing-screen")).not.toBeInTheDocument();
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.queryByTestId("status-bar")).not.toBeInTheDocument();
  });

  it("shows Sidebar and ContentArea while graphReady is false", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: samplePages, graphReady: false });
    render(<App />);
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("shows WorkspaceChooser when no workspacePath", () => {
    render(<App />);
    expect(screen.getByText("Open Workspace")).toBeInTheDocument();
  });

  it("file-modified event for current page triggers reload", async () => {
    mockListen();
    useWorkspaceStore.setState({
      workspacePath: "/test",
      pages: samplePages,
      currentPagePath: "Test Page.md",
      reloadTrigger: 0,
      graphReady: true,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Files")).toBeInTheDocument();
    });

    const before = useWorkspaceStore.getState().reloadTrigger;
    emitMockEvent("workspace://file-modified", { path: "Test Page.md" });

    await waitFor(() => {
      expect(useWorkspaceStore.getState().reloadTrigger).toBe(before + 1);
    });
  });

  it("__LIT_CLI__ with line and col sets pendingCursorLine/Col", async () => {
    window.__LIT_CLI__ = { workspace: "/cli/workspace", file: "notes.md", line: 7, col: 3 };

    mockInvoke((cmd) => {
      switch (cmd) {
        case "open_workspace":
          return samplePages;
        case "list_themes":
          return [];
        case "get_preferences":
          return {
            "workbench.colorTheme": null,
            "workbench.darkMode": "light",
            "workbench.sideBar.location": "left",
          };
        case "get_keymaps":
          return [];
        case "read_page":
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    render(<App />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspacePath).toBe("/cli/workspace");
      expect(useWorkspaceStore.getState().currentPagePath).toBe("notes.md");
      expect(useWorkspaceStore.getState().pendingCursorLine).toBe(7);
      expect(useWorkspaceStore.getState().pendingCursorCol).toBe(3);
      expect(useWorkspaceStore.getState().pendingCursorFileAbsolute).toBe(true);
    });
  });

  it("__LIT_CLI__ without line uses plain selectPage", async () => {
    window.__LIT_CLI__ = { workspace: "/cli/workspace", file: "notes.md", line: null, col: null };

    mockInvoke((cmd) => {
      switch (cmd) {
        case "open_workspace":
          return samplePages;
        case "list_themes":
          return [];
        case "get_preferences":
          return {
            "workbench.colorTheme": null,
            "workbench.darkMode": "light",
            "workbench.sideBar.location": "left",
          };
        case "get_keymaps":
          return [];
        case "read_page":
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    render(<App />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspacePath).toBe("/cli/workspace");
      expect(useWorkspaceStore.getState().currentPagePath).toBe("notes.md");
      expect(useWorkspaceStore.getState().pendingCursorLine).toBeNull();
    });
  });

  it("pending file with line sets pendingCursorLine", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_startup_context":
          return { workspace: "/pending/workspace", file: "readme.md", line: 20, col: 3 };
        case "open_workspace":
          return samplePages;
        case "list_themes":
          return [];
        case "get_preferences":
          return {
            "workbench.colorTheme": null,
            "workbench.darkMode": "light",
            "workbench.sideBar.location": "left",
          };
        case "get_keymaps":
          return [];
        case "read_page":
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    render(<App />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspacePath).toBe("/pending/workspace");
      expect(useWorkspaceStore.getState().currentPagePath).toBe("readme.md");
      expect(useWorkspaceStore.getState().pendingCursorLine).toBe(20);
      expect(useWorkspaceStore.getState().pendingCursorCol).toBe(3);
      expect(useWorkspaceStore.getState().pendingCursorFileAbsolute).toBe(true);
    });
  });

  it("initial file with line sets pendingCursorLine", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_startup_context":
          return { workspace: "/cli/workspace", file: "notes.md", line: 15, col: null };
        case "open_workspace":
          return samplePages;
        case "list_themes":
          return [];
        case "get_preferences":
          return {
            "workbench.colorTheme": null,
            "workbench.darkMode": "light",
            "workbench.sideBar.location": "left",
          };
        case "get_keymaps":
          return [];
        case "read_page":
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    render(<App />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspacePath).toBe("/cli/workspace");
      expect(useWorkspaceStore.getState().currentPagePath).toBe("notes.md");
      expect(useWorkspaceStore.getState().pendingCursorLine).toBe(15);
      expect(useWorkspaceStore.getState().pendingCursorCol).toBeNull();
      expect(useWorkspaceStore.getState().pendingCursorFileAbsolute).toBe(true);
    });
  });
});
