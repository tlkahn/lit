import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import App from "./App";
import { mockInvoke, mockListen, emitMockEvent } from "./test/tauri-mock";
import { useWorkspaceStore } from "./stores/workspace";
import { usePreferencesStore } from "./stores/preferences";
import { useLicenseStore } from "./stores/license";
import { usePaneStore } from "./stores/panes";
import { _resetForTesting as resetRegistry } from "./lib/paneContentRegistry";
import { _resetForTesting as resetEditorViewRef } from "./lib/editorViewRef";
import { SIDEBAR_WIDTH_PX } from "./components/Sidebar";

const samplePages = [
  {
    title: "Test Page",
    relative_path: "Test Page.md",
    frontmatter: {},
    created_at: 1000,
    modified_at: 2000,
    file_type: 'markdown' as const,
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

    usePaneStore.setState({
      root: { type: "leaf", id: "test-pane", pagePath: null },
      focusedPaneId: "test-pane",
    });
    resetRegistry();
    resetEditorViewRef();

    usePreferencesStore.setState({
      darkMode: "light",
      colorTheme: null,
      sidebarVisible: true,
      sidebarLocation: "left",
      loaded: true,
    });

    useLicenseStore.setState({
      state: "trial",
      daysRemaining: 12,
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
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        case "get_license_status":
          return { state: "trial", days_remaining: 12 };
        case "has_api_key":
          return false;
        case "cancel_title_suggestion":
          return undefined;
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
        case "get_license_status":
          return { state: "trial", days_remaining: 12 };
        case "cancel_title_suggestion":
          return undefined;
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
    const container = screen.getByText("Files").closest("aside")!.parentElement!.parentElement!;
    expect(container.className).toContain("flex-row");
    expect(container.className).not.toContain("flex-row-reverse");
  });

  it("renders sidebar on the right from preferences", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    usePreferencesStore.setState({ sidebarLocation: "right" });

    render(<App />);
    const container = screen.getByText("Files").closest("aside")!.parentElement!.parentElement!;
    expect(container.className).toContain("flex-row-reverse");
  });

  it("sidebar wrapper has width 0px and overflow hidden when sidebarVisible is false", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    usePreferencesStore.setState({ sidebarVisible: false });

    render(<App />);
    const aside = document.querySelector("aside")!;
    const wrapper = aside.parentElement!;
    expect(wrapper.style.width).toBe("0px");
    expect(wrapper.style.overflow).toBe("hidden");
  });

  it("sidebar wrapper has width matching SIDEBAR_WIDTH_PX when sidebarVisible is true", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    usePreferencesStore.setState({ sidebarVisible: true });

    render(<App />);
    const aside = document.querySelector("aside")!;
    const wrapper = aside.parentElement!;
    expect(wrapper.style.width).toBe(`${SIDEBAR_WIDTH_PX}px`);
  });

  it("sidebar wrapper has transition style for animation", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });

    render(<App />);
    const aside = document.querySelector("aside")!;
    const wrapper = aside.parentElement!;
    expect(wrapper.style.transition).toBe("width 150ms ease-out");
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
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        case "get_license_status":
          return { state: "trial", days_remaining: 12 };
        case "cancel_title_suggestion":
          return undefined;
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
        case "get_license_status":
          return { state: "trial", days_remaining: 12 };
        case "cancel_title_suggestion":
          return undefined;
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
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        case "get_license_status":
          return { state: "trial", days_remaining: 12 };
        case "cancel_title_suggestion":
          return undefined;
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

  it("shows Sidebar and StatusBar when workspace set and graphReady is true", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    render(<App />);
    expect(screen.queryByTestId("indexing-screen")).not.toBeInTheDocument();
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByTestId("status-bar")).toBeInTheDocument();
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
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        case "get_license_status":
          return { state: "trial", days_remaining: 12 };
        case "cancel_title_suggestion":
          return undefined;
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
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        case "get_license_status":
          return { state: "trial", days_remaining: 12 };
        case "cancel_title_suggestion":
          return undefined;
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
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        case "get_license_status":
          return { state: "trial", days_remaining: 12 };
        case "cancel_title_suggestion":
          return undefined;
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
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        case "get_license_status":
          return { state: "trial", days_remaining: 12 };
        case "cancel_title_suggestion":
          return undefined;
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

  it("App wraps content in LicenseGate and calls fetchStatus", async () => {
    useLicenseStore.setState({ state: "trial", daysRemaining: 12, loading: false });
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    const fetchStatus = vi.fn();
    useLicenseStore.setState({ fetchStatus });
    render(<App />);
    expect(fetchStatus).toHaveBeenCalled();
  });

  it("settings modal not visible by default", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    render(<App />);
    expect(screen.queryByTestId("settings-modal-backdrop")).not.toBeInTheDocument();
  });

  it("menu://enter-license-key event opens LicenseEntryDialog", async () => {
    mockListen();
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    useLicenseStore.setState({ state: "trial", daysRemaining: 12, loading: false });

    await act(async () => {
      render(<App />);
    });

    act(() => {
      emitMockEvent("menu://enter-license-key", {});
    });

    await waitFor(() => {
      expect(screen.getByTestId("license-entry-dialog")).toBeInTheDocument();
    });
  });

  it("menu://buy-license event calls openUrl", async () => {
    mockListen();
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    useLicenseStore.setState({ state: "trial", daysRemaining: 12, loading: false });

    await act(async () => {
      render(<App />);
    });

    const { openUrl } = await import("@tauri-apps/plugin-opener");

    act(() => {
      emitMockEvent("menu://buy-license", {});
    });

    await waitFor(() => {
      expect(openUrl).toHaveBeenCalledWith("https://lit.solar/buy");
    });
  });

  it("license://activate-key event triggers activation", async () => {
    mockListen();
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    useLicenseStore.setState({ state: "trial", daysRemaining: 12, loading: false });

    const activate = vi.fn().mockResolvedValue(true);
    useLicenseStore.setState({ activate });

    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      emitMockEvent("license://activate-key", "PEM-KEY-DATA");
    });

    expect(activate).toHaveBeenCalledWith("PEM-KEY-DATA");
  });

  it("menu://license-info event opens LicenseInfoDialog", async () => {
    mockListen();
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    useLicenseStore.setState({ state: "licensed", licensedTo: "Alice", loading: false });

    await act(async () => {
      render(<App />);
    });

    act(() => {
      emitMockEvent("menu://license-info", {});
    });

    await waitFor(() => {
      expect(screen.getByTestId("license-info-dialog")).toBeInTheDocument();
    });
  });

  it("lit:open-settings event opens SettingsModal", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    render(<App />);

    act(() => {
      window.dispatchEvent(new CustomEvent("lit:open-settings"));
    });

    expect(screen.getByTestId("settings-modal-backdrop")).toBeInTheDocument();
  });

  it("menu://open-preferences event opens SettingsModal", async () => {
    mockListen();
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    useLicenseStore.setState({ state: "trial", daysRemaining: 12, loading: false });

    await act(async () => {
      render(<App />);
    });

    act(() => {
      emitMockEvent("menu://open-preferences", {});
    });

    await waitFor(() => {
      expect(screen.getByTestId("settings-modal-backdrop")).toBeInTheDocument();
    });
  });

  it("license://activate-key shows entry dialog on failure", async () => {
    mockListen();
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    useLicenseStore.setState({ state: "trial", daysRemaining: 12, loading: false });

    const activate = vi.fn().mockResolvedValue(false);
    useLicenseStore.setState({ activate });

    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      emitMockEvent("license://activate-key", "BAD-KEY");
    });

    await waitFor(() => {
      expect(screen.getByTestId("license-entry-dialog")).toBeInTheDocument();
    });
  });
});
