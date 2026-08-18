import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { useEffect } from "react";
import { EditorState } from "@codemirror/state";
import App from "./App";
import { mockInvoke, mockListen, emitMockEvent, mockWindowListen, emitWindowEvent } from "./test/tauri-mock";
import { save, open } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore } from "./stores/workspace";
import { usePreferencesStore } from "./stores/preferences";
import { useLicenseStore } from "./stores/license";
import { usePaneStore, type PaneSplit } from "./stores/panes";
import { usePanePdfLinkStore } from "./stores/panePdfLink";
import { executeCommand } from "./lib/commandRegistry";
import { useBottomPanelStore } from "./stores/bottomPanel";
import { useResponsiveLayoutStore } from "./stores/responsiveLayout";
import { useStatusMessageStore } from "./stores/statusMessage";
import { _resetForTesting as resetRegistry } from "./lib/paneContentRegistry";
import { _resetForTesting as resetEditorViewRef, setCurrentEditorView } from "./lib/editorViewRef";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { SIDEBAR_WIDTH_PX } from "./components/Sidebar";
import {
  useSidebarLayoutStore,
  DEFAULT_SIDEBAR_WIDTH_PX,
  SIDEBAR_WIDTH_STORAGE_KEY,
} from "./stores/sidebarLayout";
import type { AnnotationBuilderEventDetail } from "./lib/annotationDsl";
import type { Annotation } from "./lib/ipc";
import type { EditorView } from "@codemirror/view";

// Same CodeMirrorEditor stand-in as ContentArea.test.tsx: no App test inspects
// the CM instance (the annotation-builder tests inject their own mock view via
// setCurrentEditorView, and the Ctrl-W PDF test only checks the editor testid's
// presence), so the few tests that open a page don't need to mount a live
// EditorView. PaneContainer calls view.focus() on a viewMode->"editor"
// transition, and ContentArea reads view.scrollDOM/view.state (doc/selection)
// on page switch - so the mock view carries a real EditorState (kept in sync
// with the current doc prop) rather than a bare object.
const mockCmView = {
  focus: vi.fn(),
  scrollDOM: { scrollTop: 0 },
  state: EditorState.create({ doc: "" }),
} as unknown as EditorView;

vi.mock("./editor/CodeMirrorEditor", () => ({
  CodeMirrorEditor: (props: {
    doc: string;
    style?: React.CSSProperties;
    onViewChange?: (view: EditorView | null) => void;
  }) => {
    (mockCmView as unknown as { state: EditorState }).state = EditorState.create({ doc: props.doc });
    useEffect(() => {
      props.onViewChange?.(mockCmView);
      return () => { props.onViewChange?.(null); };
    }, []);
    return (
      <div data-testid="editor" className="flex-1 overflow-hidden" style={props.style}>
        {props.doc}
      </div>
    );
  },
}));

// Stub SettingsModal: App tests only assert that the backdrop appears/disappears
// with the `open` prop; the modal's contents are covered by its own tests, so
// this is a de-weighting stub, not a correctness mask. The full-file hang this
// stub used to paper over (a stale-colorTheme reconcile effect livelocking when
// set_preference rejects) was root-caused and fixed in #891 - this file passes
// with the stub removed. Note the invoke mock in beforeEach deliberately has no
// set_preference case: rejecting persistence is exactly the hostile condition
// the fix must survive.
vi.mock("./components/SettingsModal", () => ({
  SettingsModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="settings-modal-backdrop" /> : null,
}));

// Mock pdfjs for PdfViewer (which no longer uses pdfium IPC)
vi.mock("./lib/pdfjs", () => {
  const mockRender = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const mockGetViewport = vi.fn(() => ({ width: 100, height: 200 }));
  const mockGetPage = vi.fn(() => Promise.resolve({ getViewport: mockGetViewport, render: mockRender }));
  const mockDoc = { numPages: 2, getPage: mockGetPage, destroy: vi.fn() };
  return { loadDocument: vi.fn(() => Promise.resolve(mockDoc)) };
});

const samplePages = [
  {
    title: "Test Page",
    relative_path: "Test Page.md",
    frontmatter: {},
    created_at: 1000,
    modified_at: 2000,
    file_type: 'markdown' as const,
    has_companion: false,
  },
];

describe("App", () => {
  beforeEach(() => {
    // jsdom has no real canvas; stub getContext for PdfViewer's canvas rendering
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
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
      colorTheme: "book",
      sidebarVisible: true,
      sidebarLocation: "left",
      loaded: true,
    });

    localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
    useSidebarLayoutStore.setState({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH_PX });

    useLicenseStore.setState({
      state: "licensed",
      licensedTo: null,
      source: null,
      expiresAt: null,
      expiryDate: null,
      loading: false,
      error: null,
    });

    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_app_info":
          return { name: "Lit", version: "0.0.0" };
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
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown", has_companion: false }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        case "get_license_status":
          return { state: "licensed", licensed_to: "Test User", source: "direct" };
        case "has_api_key":
          return false;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
  });

  it("shows workspace chooser when no workspace open", () => {
    render(<App />);
    expect(screen.getByText("Open Workspace")).toBeInTheDocument();
  });

  it("app main wrapper contains min-w-0 for row min-size containment", () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      pages: samplePages,
      graphReady: true,
    });
    render(<App />);
    const wrapper = screen.getByTestId("app-main-wrapper");
    expect(wrapper.className).toContain("min-w-0");
    // regression: must keep the existing flex/min-size classes
    expect(wrapper.className).toContain("min-h-0");
    expect(wrapper.className).toContain("flex-1");
    expect(wrapper.className).toContain("flex");
    expect(wrapper.className).toContain("flex-col");
  });

  it("shows sidebar and content when workspace is open", async () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      pages: samplePages,
      graphReady: true,
    });

    render(<App />);
    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
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
          return { state: "licensed", licensed_to: "Test User", source: "direct" };
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
    const container = screen.getByRole("button", { name: "Files" }).closest("aside")!.parentElement!.parentElement!;
    expect(container.className).toContain("flex-row");
    expect(container.className).not.toContain("flex-row-reverse");
  });

  it("renders sidebar on the right from preferences", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    usePreferencesStore.setState({ sidebarLocation: "right" });

    render(<App />);
    const container = screen.getByRole("button", { name: "Files" }).closest("aside")!.parentElement!.parentElement!;
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

  it("sidebar shell follows store width when set via setSidebarWidth", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    useSidebarLayoutStore.getState().setSidebarWidth(320);

    render(<App />);
    const shell = screen.getByTestId("sidebar-shell");
    expect(shell.style.width).toBe("320px");
  });

  it("sidebar shell collapses to 0px while store keeps width when hidden", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    useSidebarLayoutStore.getState().setSidebarWidth(320);
    usePreferencesStore.setState({ sidebarVisible: false });

    render(<App />);
    const shell = screen.getByTestId("sidebar-shell");
    expect(shell.style.width).toBe("0px");
    expect(useSidebarLayoutStore.getState().sidebarWidth).toBe(320);
    expect(shell.style.overflow).toBe("hidden");
    expect(shell.style.transition).toBe("width 150ms ease-out");
  });

  it("overlay path uses store width, not 0", () => {
    const origWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true, writable: true });
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    useSidebarLayoutStore.getState().setSidebarWidth(320);
    useResponsiveLayoutStore.setState({ windowWidth: 800, sidebarAutoCollapsed: true });
    usePreferencesStore.setState({ sidebarVisible: true });

    render(<App />);
    const shell = screen.getByTestId("sidebar-shell");
    expect(shell.style.width).toBe("320px");
    expect(shell.style.position).toBe("absolute");

    Object.defineProperty(window, "innerWidth", { value: origWidth, configurable: true, writable: true });
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
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown", has_companion: false }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        case "get_license_status":
          return { state: "licensed", licensed_to: "Test User", source: "direct" };
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
          return { state: "licensed", licensed_to: "Test User", source: "direct" };
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
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown", has_companion: false }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        case "get_license_status":
          return { state: "licensed", licensed_to: "Test User", source: "direct" };
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
    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByTestId("status-bar")).toBeInTheDocument();
  });

  it("shows Sidebar and StatusBar when workspace set and graphReady is true", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    render(<App />);
    expect(screen.queryByTestId("indexing-screen")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByTestId("status-bar")).toBeInTheDocument();
  });

  it("shows Sidebar and ContentArea while graphReady is false", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: samplePages, graphReady: false });
    render(<App />);
    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
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
      expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
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
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown", has_companion: false }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        case "get_license_status":
          return { state: "licensed", licensed_to: "Test User", source: "direct" };
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
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown", has_companion: false }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        case "get_license_status":
          return { state: "licensed", licensed_to: "Test User", source: "direct" };
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
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown", has_companion: false }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        case "get_license_status":
          return { state: "licensed", licensed_to: "Test User", source: "direct" };
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
          return { meta: { title: "Test", relative_path: "test.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown", has_companion: false }, body: "", raw_yaml: "" };
        case "get_backlinks":
          return [];
        case "parse_raw_yaml":
          return {};
        case "ensure_graph_ready":
          return null;
        case "get_license_status":
          return { state: "licensed", licensed_to: "Test User", source: "direct" };
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
    useLicenseStore.setState({ state: "licensed", loading: false });
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
    useLicenseStore.setState({ state: "licensed", loading: false });

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

  it("menu://enter-license-key opens LicenseEntryDialog during the splash (unlicensed)", async () => {
    mockListen();
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    useLicenseStore.setState({ state: "unlicensed", loading: false });

    await act(async () => {
      render(<App />);
    });

    // While unlicensed the splash gates away the app, so the dialog must be
    // rendered by LicenseGate itself rather than inside the gated children.
    expect(screen.queryByTestId("license-entry-dialog")).not.toBeInTheDocument();

    act(() => {
      emitMockEvent("menu://enter-license-key", {});
    });

    await waitFor(() => {
      expect(screen.getByTestId("license-entry-dialog")).toBeInTheDocument();
    });
  });

  it("splash inline Enter License Key button and menu open the SAME single dialog", async () => {
    mockListen();
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    useLicenseStore.setState({ state: "unlicensed", loading: false });

    await act(async () => {
      render(<App />);
    });

    expect(screen.queryByTestId("license-entry-dialog")).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId("splash-enter-key"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("license-entry-dialog")).toBeInTheDocument();
    });
    // Exactly one dialog in the tree — guards against the gate and App each
    // rendering their own LicenseEntryDialog after the refactor.
    expect(screen.getAllByTestId("license-entry-dialog")).toHaveLength(1);
  });

  it("menu://buy-license event calls openUrl", async () => {
    mockListen();
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    useLicenseStore.setState({ state: "licensed", loading: false });

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
    useLicenseStore.setState({ state: "licensed", loading: false });

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
    mockWindowListen();
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    useLicenseStore.setState({ state: "licensed", loading: false });

    await act(async () => {
      render(<App />);
    });

    act(() => {
      emitWindowEvent("menu://open-preferences", {});
    });

    await waitFor(() => {
      expect(screen.getByTestId("settings-modal-backdrop")).toBeInTheDocument();
    });
  });

  it("menu://new-page event creates an untitled page", async () => {
    mockListen();
    mockWindowListen();
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    useLicenseStore.setState({ state: "licensed", loading: false });

    // Stub the store's createPage so the menu path is exercised without
    // touching IPC; the real create flow is covered by StatusBar/helper tests.
    const createPageSpy = vi
      .spyOn(useWorkspaceStore.getState(), "createPage")
      .mockResolvedValue(undefined);

    await act(async () => {
      render(<App />);
    });

    act(() => {
      emitWindowEvent("menu://new-page", {});
    });

    await waitFor(() => {
      expect(createPageSpy).toHaveBeenCalledWith("Untitled");
    });
    createPageSpy.mockRestore();
  });

  it("license://activate-key shows entry dialog on failure", async () => {
    mockListen();
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    useLicenseStore.setState({ state: "licensed", loading: false });

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

  it("bottom-mode panel is not a direct child of the flex row", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    usePreferencesStore.setState({ bottomPanelPosition: "bottom" });
    render(<App />);
    const bottomPanel = screen.getByTestId("bottom-panel");
    expect(bottomPanel.parentElement?.className).not.toMatch(/flex-row/);
  });

  it("renders BottomPanel as a sidebar when bottomPanelPosition is 'side'", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    usePreferencesStore.setState({ bottomPanelPosition: "side" });
    render(<App />);
    const bottomPanel = screen.getByTestId("bottom-panel");
    expect(bottomPanel.parentElement?.className).toContain("flex-row");
  });

  it("only one BottomPanel exists in DOM when mode is 'side'", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: samplePages, graphReady: true });
    usePreferencesStore.setState({ bottomPanelPosition: "side" });
    render(<App />);
    expect(screen.getAllByTestId("bottom-panel")).toHaveLength(1);
  });

  it("sidebar-mode panel has flex-shrink-0", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    usePreferencesStore.setState({ bottomPanelPosition: "side" });
    render(<App />);
    const bottomPanel = screen.getByTestId("bottom-panel");
    expect(bottomPanel.className).toContain("flex-shrink-0");
  });

  it("sidebar-mode panel appears after editor column when sidebar is on left", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    usePreferencesStore.setState({ bottomPanelPosition: "side", sidebarLocation: "left" });
    render(<App />);
    const bottomPanel = screen.getByTestId("bottom-panel");
    const flexRow = bottomPanel.parentElement!;
    expect(flexRow.className).toContain("flex-row");
    expect(flexRow.className).not.toContain("flex-row-reverse");
    const children = Array.from(flexRow.children);
    expect(children.indexOf(bottomPanel)).toBe(children.length - 1);
  });

  it("sidebar-mode panel appears on the left when sidebar is on the right", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    usePreferencesStore.setState({ bottomPanelPosition: "side", sidebarLocation: "right" });
    render(<App />);
    const bottomPanel = screen.getByTestId("bottom-panel");
    const flexRow = bottomPanel.parentElement!;
    expect(flexRow.className).toContain("flex-row-reverse");
    const children = Array.from(flexRow.children);
    expect(children.indexOf(bottomPanel)).toBe(children.length - 1);
  });

  it("sidebar-mode panel is a direct child of the flex row", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: samplePages, graphReady: true });
    usePaneStore.setState({
      root: { type: "leaf", id: "test-pane", pagePath: "Test Page.md" },
      focusedPaneId: "test-pane",
    });
    usePreferencesStore.setState({ bottomPanelPosition: "side" });
    render(<App />);
    const bottomPanel = screen.getByTestId("bottom-panel");
    expect(bottomPanel.parentElement?.className).toContain("flex-row");
  });

  it("sidebar-mode panel exists when panel is collapsed", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
    usePreferencesStore.setState({ bottomPanelPosition: "side" });
    useBottomPanelStore.setState({ unfolded: false });
    render(<App />);
    expect(screen.getByTestId("bottom-panel")).toBeInTheDocument();
  });

  function mockEditorView(text: string, head: number) {
    const doc = {
      length: text.length,
      sliceString: (from: number, to: number) => text.slice(from, to),
      lineAt: (pos: number) => {
        const from = text.lastIndexOf("\n", pos - 1) + 1;
        const nl = text.indexOf("\n", pos);
        return { from, to: nl === -1 ? text.length : nl };
      },
    };
    const dispatch = vi.fn();
    const view = {
      dispatch,
      state: { selection: { main: { head } }, doc },
      focus: vi.fn(),
    };
    setCurrentEditorView(view as unknown as EditorView);
    return { view, dispatch };
  }

  function openAnnotationBuilder(detail: AnnotationBuilderEventDetail) {
    act(() => {
      window.dispatchEvent(
        new CustomEvent<AnnotationBuilderEventDetail>("lit:open-annotation-builder", { detail }),
      );
    });
  }

  it("create-mode annotation insert is placed after the original selected range", async () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });

    const text = "some words hello and plenty more text following on the same line";
    const { view, dispatch } = mockEditorView(text, 99);

    render(<App />);

    openAnnotationBuilder({ mode: "create", selectedText: "hello", originalRange: { from: 11, to: 16 } });

    await waitFor(() => {
      expect(screen.getByTestId("annotation-builder-backdrop")).toBeInTheDocument();
    });

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 0; });

    fireEvent.click(screen.getByTestId("annotation-insert-btn"));

    expect(dispatch).toHaveBeenCalled();
    const arg = dispatch.mock.calls[0]![0];
    expect(arg.changes.from).toBe(16);
    expect(arg.changes.insert).not.toContain("\n");
    expect(arg.selection.anchor).toBe(16);
    expect(arg.selection.head).toBe(16 + arg.changes.insert.length);
    expect(view.focus).toHaveBeenCalled();
  });

  it("mid-line create shows no form toggle and inserts inline", async () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });

    mockEditorView("first line of text\nsecond line", 5);

    render(<App />);
    openAnnotationBuilder({ mode: "create" });

    await waitFor(() => {
      expect(screen.getByTestId("annotation-builder-backdrop")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("annotation-overflow-toggle"));
    expect(screen.queryByTestId("annotation-form-toggle-block")).not.toBeInTheDocument();
    expect(screen.getByTestId("annotation-inline-hint")).toBeInTheDocument();
  });

  it("block-form insert at end of a non-empty line gets a newline prefix", async () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });

    const text = "1. first item\n2. second item";
    const lineEnd = text.indexOf("\n"); // end of "1. first item"
    const { dispatch } = mockEditorView(text, lineEnd);

    render(<App />);
    openAnnotationBuilder({ mode: "create" });

    await waitFor(() => {
      expect(screen.getByTestId("annotation-builder-backdrop")).toBeInTheDocument();
    });

    // At line end the form toggle is available (in the advanced group); a
    // multi-line body forces block.
    fireEvent.click(screen.getByTestId("annotation-overflow-toggle"));
    expect(screen.getByTestId("annotation-form-toggle-block")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("annotation-body-input"), {
      target: { value: "line one\nline two" },
    });

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 0; });
    fireEvent.click(screen.getByTestId("annotation-insert-btn"));

    const arg = dispatch.mock.calls[0]![0];
    expect(arg.changes.from).toBe(lineEnd);
    expect(arg.changes.insert).toMatch(/^\n<!---/);
    expect(arg.changes.insert).toContain("\n---\nline one\nline two\n--->");
    expect(arg.selection.anchor).toBe(lineEnd + 1);
    expect(arg.selection.head).toBe(lineEnd + arg.changes.insert.length);
  });

  it("block-form insert at the start of an empty line gets no prefix", async () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });

    const text = "first line\n\nthird line";
    const emptyLinePos = "first line\n".length;
    const { dispatch } = mockEditorView(text, emptyLinePos);

    render(<App />);
    openAnnotationBuilder({ mode: "create" });

    await waitFor(() => {
      expect(screen.getByTestId("annotation-builder-backdrop")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("annotation-body-input"), {
      target: { value: "line one\nline two" },
    });

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 0; });
    fireEvent.click(screen.getByTestId("annotation-insert-btn"));

    const arg = dispatch.mock.calls[0]![0];
    expect(arg.changes.from).toBe(emptyLinePos);
    expect(arg.changes.insert).toMatch(/^<!---/);
    expect(arg.changes.insert).toContain("\n---\nline one\nline two\n--->");
    expect(arg.selection.anchor).toBe(emptyLinePos);
  });

  it("edit-mode update replaces the original range in place and keeps block form", async () => {
    useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });

    const original = "<!---\nn\n---\nline one\nline two\n--->";
    const text = `prefix text\n${original}\nsuffix`;
    const range = { from: "prefix text\n".length, to: "prefix text\n".length + original.length };
    const { dispatch } = mockEditorView(text, 0);

    const annotation: Annotation = {
      form: "block",
      annotation_type: "note",
      certainty: "neutral",
      scope: { kind: "sentence", value: 1 },
      body: "line one\nline two",
      date: null,
      is_structured: true,
      char_start: range.from,
      char_end: range.to,
      original,
    };

    render(<App />);
    openAnnotationBuilder({ mode: "edit", annotation, originalRange: range });

    await waitFor(() => {
      expect(screen.getByTestId("annotation-builder-backdrop")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("annotation-form-toggle-block")).not.toBeInTheDocument();

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 0; });
    fireEvent.click(screen.getByTestId("annotation-insert-btn"));

    const arg = dispatch.mock.calls[0]![0];
    expect(arg.changes.from).toBe(range.from);
    expect(arg.changes.to).toBe(range.to);
    expect(arg.changes.insert).toMatch(/^<!---\n/);
    expect(arg.selection.anchor).toBe(range.from);
  });

  describe("Ctrl-W on last PDF pane (issue #447)", () => {
    const mdPage = {
      title: "Notes",
      relative_path: "Notes.md",
      frontmatter: {},
      created_at: 1000,
      modified_at: 2000,
      file_type: "markdown" as const,
      has_companion: false,
    };
    const pdfPage = {
      title: "Doc",
      relative_path: "doc.pdf",
      frontmatter: {},
      created_at: 1000,
      modified_at: 2000,
      file_type: "pdf" as const,
      has_companion: false,
    };

    it("closing the md pane then the last PDF pane shows the empty state, not a blank area", async () => {
      mockInvoke((cmd) => {
        switch (cmd) {
          case "read_page":
            return { meta: mdPage, body: "# Notes", raw_yaml: "" };
          case "get_backlinks":
            return [];
          case "parse_raw_yaml":
            return {};
          case "get_keymaps":
            return [];
          case "acknowledge_file_hash":
            return null;
          case "get_app_info":
            return { name: "Lit", version: "0.0.0" };
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
          case "ensure_graph_ready":
            return null;
          case "get_license_status":
            return { state: "licensed", licensed_to: "Test User", source: "direct" };
          case "has_api_key":
            return false;
          case "allow_asset_scope":
            return undefined;
          default:
            throw new Error(`Unknown command: ${cmd}`);
        }
      });

      useWorkspaceStore.setState({
        workspacePath: "/test",
        pages: [mdPage, pdfPage],
        currentPagePath: "Notes.md",
        graphReady: true,
      });
      // End state of the companion-split workflow (Mod-Shift-o from the md
      // note): md pane and pdf pane side by side, linked, md pane focused.
      const root: PaneSplit = {
        type: "split",
        id: "split-1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "md-pane", pagePath: "Notes.md" },
          { type: "leaf", id: "pdf-pane", pagePath: "doc.pdf" },
        ],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root, focusedPaneId: "md-pane" });
      usePanePdfLinkStore.getState().linkPanes("md-pane", "pdf-pane");

      const { loadDocument } = await import("./lib/pdfjs");
      const loadDocumentMock = loadDocument as unknown as ReturnType<typeof vi.fn>;

      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-viewer-pane")).toBeInTheDocument();
        expect(screen.getByTestId("editor")).toBeInTheDocument();
      });
      // allowAssetScope (invoked before loadDocument) adds an extra async
      // step, so loadDocument may not have fired yet when the DOM appears.
      await waitFor(() => {
        expect(loadDocumentMock).toHaveBeenCalledTimes(1);
      });

      // First Ctrl-W: closes the focused md pane, split collapses to the PDF.
      // (The PDF pane remounts at its new tree position, so loadDocument may
      // legitimately fire again here — snapshot the count after settling.)
      act(() => {
        executeCommand("pane.close");
      });
      await waitFor(() => {
        expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
        expect(screen.getByTestId("pdf-viewer-pane")).toBeInTheDocument();
      });
      expect(usePaneStore.getState().focusedPaneId).toBe("pdf-pane");
      const loadsAfterCollapse = loadDocumentMock.mock.calls.length;

      // Second Ctrl-W: closes the last (PDF) pane. The content area must show
      // the empty-state placeholder — not a blank region or the error fallback.
      act(() => {
        executeCommand("pane.close");
      });

      await waitFor(() => {
        expect(screen.getByTestId("empty-state")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("content-error-fallback")).not.toBeInTheDocument();
      expect(screen.queryByTestId("pdf-viewer-pane")).not.toBeInTheDocument();
      expect(useWorkspaceStore.getState().currentPagePath).toBeNull();
      // No resurrection: a stale workspace.currentPagePath must not re-open
      // the just-closed PDF on a ContentArea remount.
      expect(loadDocumentMock.mock.calls.length).toBe(loadsAfterCollapse);
    });
  });

  describe("window listener cleanup", () => {
    it("unlistens a window listener that resolves after unmount", async () => {
      // Inject a deferred listen() promise for ONE of the buggy effects'
      // events so we can unmount BEFORE it resolves, exercising the
      // fast-unmount race. The shared mockWindowListen resolves synchronously
      // and cannot reproduce this. We target "lit:export-progress" specifically
      // (one of the three effects under test) and leave the already-guarded
      // cli-navigate effect on a resolved no-op so it cannot mask the leak.
      let resolveListen!: (fn: () => void) => void;
      const listenPromise = new Promise<() => void>((r) => {
        resolveListen = r;
      });
      const unlistenSpy = vi.fn();

      vi.mocked(getCurrentWebviewWindow).mockReturnValue({
        listen: vi.fn((event: string) =>
          event === "lit:export-progress"
            ? listenPromise
            : Promise.resolve(vi.fn()),
        ),
        onDragDropEvent: vi.fn(() => Promise.resolve(vi.fn())),
      } as unknown as ReturnType<typeof getCurrentWebviewWindow>);

      useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });

      let unmount!: () => void;
      await act(async () => {
        ({ unmount } = render(<App />));
      });

      // Unmount while the listen() promise is still pending.
      act(() => {
        unmount();
      });

      // Now resolve the listen() promise. The effect cleanup already ran, so the
      // cancelled guard must immediately tear down the late-arriving listener.
      await act(async () => {
        resolveListen(unlistenSpy);
        await Promise.resolve();
      });

      expect(unlistenSpy).toHaveBeenCalled();
    });
  });

  describe("LKG bundle wiring", () => {
    const mockedSave = save as unknown as ReturnType<typeof vi.fn>;
    const mockedOpen = open as unknown as ReturnType<typeof vi.fn>;
    const HASH = "sha256:" + "a".repeat(64);

    function defaultLkgInvoke(cmd: string): unknown {
      switch (cmd) {
        case "get_app_info":
          return { name: "Lit", version: "0.0.0" };
        case "open_workspace":
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
        case "export_lkg":
          return { exported_count: 3, destination: "/out/graph.lkg", graph_hash: HASH };
        case "import_lkg":
          return { node_count: 2, edge_count: 1, annotation_count: 0, file_count: 3 };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    }

    function lkgMockInvoke(invokedCmds?: string[]) {
      mockInvoke((cmd) => {
        if (invokedCmds) invokedCmds.push(cmd);
        return defaultLkgInvoke(cmd);
      });
    }

    beforeEach(() => {
      vi.clearAllMocks();
      mockListen();
      mockWindowListen();
      useWorkspaceStore.setState({ workspacePath: "/test", pages: [], graphReady: true });
      useStatusMessageStore.setState({ message: null, variant: "success" });
    });

    // === CYCLE J1 — export ===

    it("menu://export-lkg event opens .lkg save dialog and calls exportLkg", async () => {
      const invokeArgs: Array<Record<string, unknown> | undefined> = [];
      mockInvoke((cmd, args) => {
        if (cmd === "export_lkg") {
          invokeArgs.push(args);
          return { exported_count: 3, destination: "/out/graph.lkg", graph_hash: HASH };
        }
        return defaultLkgInvoke(cmd);
      });
      mockedSave.mockResolvedValue("/out/graph.lkg");

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitWindowEvent("menu://export-lkg", {});
      });

      await waitFor(() => {
        expect(mockedSave).toHaveBeenCalledWith({
          defaultPath: "export.lkg",
          filters: [{ name: "Lit Knowledge Graph", extensions: ["lkg"] }],
        });
      });

      await waitFor(() => {
        expect(invokeArgs.length).toBe(1);
      });
      expect(invokeArgs[0]).toEqual({ destination: "/out/graph.lkg", title: null, description: null });
    });

    it("save dialog returning null does not call export_lkg", async () => {
      const invokedCmds: string[] = [];
      lkgMockInvoke(invokedCmds);
      mockedSave.mockResolvedValue(null);

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitWindowEvent("menu://export-lkg", {});
      });

      await waitFor(() => {
        expect(mockedSave).toHaveBeenCalled();
      });
      expect(invokedCmds).not.toContain("export_lkg");
    });

    it("lit:lkg-export-progress event shows progress in status bar", async () => {
      lkgMockInvoke();
      await act(async () => {
        render(<App />);
      });

      act(() => {
        emitWindowEvent("lit:lkg-export-progress", { current: 2, total: 5 });
      });

      await waitFor(() => {
        expect(screen.getByTestId("status-bar-message")).toHaveTextContent("Exporting 2/5…");
      });
    });

    it("lit:lkg-export-complete event shows export summary in status bar", async () => {
      lkgMockInvoke();
      await act(async () => {
        render(<App />);
      });

      act(() => {
        emitWindowEvent("lit:lkg-export-complete", {
          exported_count: 3,
          destination: "/out/graph.lkg",
          graph_hash: HASH,
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("status-bar-message")).toHaveTextContent("Exported 3 files");
      });
    });

    it("export_lkg rejection shows error in status bar", async () => {
      mockInvoke((cmd) => {
        if (cmd === "export_lkg") return Promise.reject(new Error("disk full"));
        return defaultLkgInvoke(cmd);
      });
      mockedSave.mockResolvedValue("/out/graph.lkg");

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitWindowEvent("menu://export-lkg", {});
      });

      await waitFor(() => {
        expect(screen.getByTestId("status-bar-message")).toHaveTextContent(/disk full/i);
      });
    });

    // === CYCLE J2 — import ===

    it("menu://import-lkg event picks source file then destination folder and calls importLkg", async () => {
      const invokeArgs: Array<Record<string, unknown> | undefined> = [];
      mockInvoke((cmd, args) => {
        if (cmd === "import_lkg") {
          invokeArgs.push(args);
          return { node_count: 2, edge_count: 1, annotation_count: 0, file_count: 3 };
        }
        return defaultLkgInvoke(cmd);
      });
      mockedOpen.mockResolvedValueOnce("/in/graph.lkg").mockResolvedValueOnce("/dest/folder");

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitWindowEvent("menu://import-lkg", {});
      });

      await waitFor(() => {
        expect(invokeArgs.length).toBe(1);
      });
      expect(mockedOpen).toHaveBeenNthCalledWith(1, {
        multiple: false,
        filters: [{ name: "Lit Knowledge Graph", extensions: ["lkg"] }],
      });
      expect(mockedOpen).toHaveBeenNthCalledWith(2, { directory: true });
      expect(invokeArgs[0]).toEqual({ source: "/in/graph.lkg", destination: "/dest/folder" });
    });

    it("cancelling source file picker does not open folder picker or call import_lkg", async () => {
      const invokedCmds: string[] = [];
      lkgMockInvoke(invokedCmds);
      mockedOpen.mockResolvedValueOnce(null);

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitWindowEvent("menu://import-lkg", {});
      });

      await waitFor(() => {
        expect(mockedOpen).toHaveBeenCalledTimes(1);
      });
      expect(invokedCmds).not.toContain("import_lkg");
    });

    it("cancelling destination folder picker does not call import_lkg", async () => {
      const invokedCmds: string[] = [];
      lkgMockInvoke(invokedCmds);
      mockedOpen.mockResolvedValueOnce("/in/graph.lkg").mockResolvedValueOnce(null);

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitWindowEvent("menu://import-lkg", {});
      });

      await waitFor(() => {
        expect(mockedOpen).toHaveBeenCalledTimes(2);
      });
      expect(invokedCmds).not.toContain("import_lkg");
    });

    it("import shows summary in status bar after menu flow", async () => {
      lkgMockInvoke();
      mockedOpen.mockResolvedValueOnce("/in/graph.lkg").mockResolvedValueOnce("/dest/folder");

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitWindowEvent("menu://import-lkg", {});
      });

      await waitFor(() => {
        expect(screen.getByTestId("status-bar-message")).toBeInTheDocument();
      });
      // A single successful import must produce exactly ONE success toast. The
      // success summary is reported only through the direct importLkg() return
      // value; there is no redundant lit:lkg-import-complete event path.
      expect(
        screen.getAllByText(/Imported 2 nodes, 1 edges, 0 annotations, 3 files/),
      ).toHaveLength(1);
    });

    // === Scope isolation ===

    it("global emit of menu://export-lkg does NOT trigger window-scoped handler", async () => {
      lkgMockInvoke();
      mockedSave.mockResolvedValue("/out/graph.lkg");

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitMockEvent("menu://export-lkg", {});
      });

      // Global emit should not reach window-scoped listener, so save() should NOT be called
      expect(mockedSave).not.toHaveBeenCalled();
    });

    it("global emit of lit:lkg-export-progress does NOT trigger window-scoped handler", async () => {
      lkgMockInvoke();
      await act(async () => {
        render(<App />);
      });

      act(() => {
        emitMockEvent("lit:lkg-export-progress", { current: 2, total: 5 });
      });

      expect(screen.queryByTestId("status-bar-message")).not.toBeInTheDocument();
    });
  });

  describe("Cardbox HTML export wiring", () => {
    const mockedSave = save as unknown as ReturnType<typeof vi.fn>;

    function defaultCardboxInvoke(cmd: string): unknown {
      switch (cmd) {
        case "get_app_info":
          return { name: "Lit", version: "0.0.0" };
        case "open_workspace":
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
        case "list_all_annotations":
          return [
            {
              uuid: "u1",
              annotation_type: "note",
              certainty: "medium",
              body: "test body",
              date: null,
              source_page_id: "notes/hello.md",
              source_page_title: "Hello",
              source_line: 1,
              char_start: 0,
              char_end: 10,
              scope_kind: "word",
              scope_value: "w",
              original: "quoted",
            },
          ];
        case "export_cardbox_html":
          return "/out/cards.html";
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    }

    beforeEach(() => {
      vi.clearAllMocks();
      mockListen();
      mockWindowListen();
      useWorkspaceStore.setState({
        workspacePath: "/test",
        currentPagePath: "notes/hello.md",
        pages: [],
        graphReady: true,
      });
      useStatusMessageStore.setState({ message: null, variant: "success" });
    });

    it("menu://export-cardbox-html with currentPagePath calls save and export_cardbox_html", async () => {
      let exportHtml = "";
      mockInvoke((cmd, args) => {
        if (cmd === "export_cardbox_html") {
          exportHtml = (args as { html: string }).html;
          return "/out/cards.html";
        }
        return defaultCardboxInvoke(cmd);
      });
      mockedSave.mockResolvedValue("/out/cards.html");

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitWindowEvent("menu://export-cardbox-html", {});
      });

      await waitFor(() => {
        expect(mockedSave).toHaveBeenCalledWith({
          defaultPath: "hello.html",
          filters: [{ name: "HTML", extensions: ["html"] }],
        });
      });

      await waitFor(() => {
        expect(exportHtml).toMatch(/^<!DOCTYPE html>/);
      });
    });

    it("save returning null does not call export_cardbox_html", async () => {
      const invokedCmds: string[] = [];
      mockInvoke((cmd) => {
        invokedCmds.push(cmd);
        return defaultCardboxInvoke(cmd);
      });
      mockedSave.mockResolvedValue(null);

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitWindowEvent("menu://export-cardbox-html", {});
      });

      await waitFor(() => {
        expect(mockedSave).toHaveBeenCalled();
      });
      expect(invokedCmds).not.toContain("export_cardbox_html");
    });

    it("no page shows info toast instead of exporting", async () => {
      mockInvoke((cmd) => defaultCardboxInvoke(cmd));
      useWorkspaceStore.setState({
        workspacePath: "/test",
        currentPagePath: null,
        pages: [],
        graphReady: true,
      });

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitWindowEvent("menu://export-cardbox-html", {});
      });

      await waitFor(() => {
        const state = useStatusMessageStore.getState();
        expect(state.message).toBe("Open a document first");
        expect(state.variant).toBe("info");
      });
      expect(mockedSave).not.toHaveBeenCalled();
    });

    it("global emit does NOT trigger window-scoped handler", async () => {
      mockInvoke((cmd) => defaultCardboxInvoke(cmd));
      mockedSave.mockResolvedValue("/out/cards.html");

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitMockEvent("menu://export-cardbox-html", {});
      });

      expect(mockedSave).not.toHaveBeenCalled();
    });
  });

  describe("Cardbox Anki export wiring", () => {
    const mockedSave = save as unknown as ReturnType<typeof vi.fn>;

    function defaultAnkiInvoke(cmd: string): unknown {
      switch (cmd) {
        case "get_app_info":
          return { name: "Lit", version: "0.0.0" };
        case "open_workspace":
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
        case "list_all_annotations":
          return [
            {
              uuid: "u1",
              annotation_type: "note",
              certainty: "medium",
              body: "test body",
              date: null,
              source_page_id: "notes/hello.md",
              source_page_title: "Hello",
              source_line: 1,
              char_start: 0,
              char_end: 10,
              scope_kind: "word",
              scope_value: "w",
              original: "quoted",
            },
          ];
        case "export_cardbox_anki":
          return "/out/cards.apkg";
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    }

    beforeEach(() => {
      vi.clearAllMocks();
      mockListen();
      mockWindowListen();
      useWorkspaceStore.setState({
        workspacePath: "/test",
        currentPagePath: "notes/hello.md",
        pages: [],
        graphReady: true,
      });
      useStatusMessageStore.setState({ message: null, variant: "success" });
    });

    it("M1: menu://export-cardbox-anki with currentPagePath calls save and export_cardbox_anki", async () => {
      let invokedAnki: {
        destination: string;
        deckName: string;
        deckKey: string;
        notes: Array<{ uuid: string; front_html: string; back_html: string }>;
      } | null = null;
      mockInvoke((cmd, args) => {
        if (cmd === "export_cardbox_anki") {
          invokedAnki = args as typeof invokedAnki;
          return "/out/cards.apkg";
        }
        return defaultAnkiInvoke(cmd);
      });
      mockedSave.mockResolvedValue("/out/cards.apkg");

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitWindowEvent("menu://export-cardbox-anki", {});
      });

      await waitFor(() => {
        expect(mockedSave).toHaveBeenCalledWith({
          defaultPath: "hello.apkg",
          filters: [{ name: "Anki Package", extensions: ["apkg"] }],
        });
      });

      await waitFor(() => {
        expect(invokedAnki).not.toBeNull();
        expect(invokedAnki!.destination).toBe("/out/cards.apkg");
        expect(invokedAnki!.deckName).toBe("Hello");
        expect(invokedAnki!.deckKey).toBe("notes/hello.md");
        expect(invokedAnki!.notes).toHaveLength(1);
        expect(invokedAnki!.notes[0]).toMatchObject({ uuid: "u1" });
      });
    });

    it("M2: save returning null does not call export_cardbox_anki", async () => {
      const invokedCmds: string[] = [];
      mockInvoke((cmd) => {
        invokedCmds.push(cmd);
        return defaultAnkiInvoke(cmd);
      });
      mockedSave.mockResolvedValue(null);

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitWindowEvent("menu://export-cardbox-anki", {});
      });

      await waitFor(() => {
        expect(mockedSave).toHaveBeenCalled();
      });
      expect(invokedCmds).not.toContain("export_cardbox_anki");
    });

    it("M3: no page shows info toast instead of exporting", async () => {
      mockInvoke((cmd) => defaultAnkiInvoke(cmd));
      useWorkspaceStore.setState({
        workspacePath: "/test",
        currentPagePath: null,
        pages: [],
        graphReady: true,
      });

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitWindowEvent("menu://export-cardbox-anki", {});
      });

      await waitFor(() => {
        const state = useStatusMessageStore.getState();
        expect(state.message).toBe("Open a document first");
        expect(state.variant).toBe("info");
      });
      expect(mockedSave).not.toHaveBeenCalled();
    });

    it("M4: global emit does NOT trigger window-scoped handler", async () => {
      mockInvoke((cmd) => defaultAnkiInvoke(cmd));
      mockedSave.mockResolvedValue("/out/cards.apkg");

      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        emitMockEvent("menu://export-cardbox-anki", {});
      });

      expect(mockedSave).not.toHaveBeenCalled();
    });
  });
});
