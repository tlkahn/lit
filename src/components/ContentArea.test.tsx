import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentArea, parseYamlErrorLocation } from "./ContentArea";
import { mockInvoke, mockListen, emitMockEvent, resetListenMock } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { commandRegistry } from "../lib/commands";

import { globalJumpTracker } from "../editor/jumpTracker";

const samplePage = {
  body: "# Hello\nSome content",
  raw_yaml: "tags:\n  - test\n",
  meta: {
    title: "Hello",
    frontmatter: { tags: ["test"] },
    relative_path: "Hello.md",
    created_at: 1000,
    modified_at: 2000,
    file_type: 'markdown' as const,
  },
};

const otherPage = {
  body: "# Other\nDifferent content",
  raw_yaml: "",
  meta: {
    title: "Other",
    frontmatter: {},
    relative_path: "Other.md",
    created_at: 1000,
    modified_at: 2000,
    file_type: 'markdown' as const,
  },
};

let writePageCalls: Array<{ path: string; body: string }> = [];

beforeEach(() => {
  writePageCalls = [];
  useWorkspaceStore.setState({
    workspacePath: "/test",
    pages: [],
    currentPagePath: null,
    currentPageHeadings: [],
    isDirty: false,
    reloadTrigger: 0,
    viewStates: {},
    loading: false,
    error: null,
  });

  mockInvoke((cmd, args) => {
    if (cmd === "read_page") {
      const rp = (args as Record<string, unknown>)?.relativePath;
      if (rp === "Other.md") return otherPage;
      return samplePage;
    }
    if (cmd === "write_page") {
      writePageCalls.push({
        path: (args as Record<string, unknown>)?.relativePath as string,
        body: (args as Record<string, unknown>)?.body as string,
      });
      return null;
    }
    if (cmd === "parse_raw_yaml") {
      const raw = (args as Record<string, unknown>)?.rawYaml as string;
      if (raw.includes("[[[")) throw new Error("did not find expected ',' or ']' at line 1 column 6");
      if (raw.trim() === "") return {};
      return { tags: ["test"] };
    }
    if (cmd === "get_backlinks") return [];
    if (cmd === "get_keymaps") return [];
    throw new Error(`Unknown command: ${cmd}`);
  });
});

describe("ContentArea", () => {
  it("shows empty state when no page selected", () => {
    render(<ContentArea />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("loads page content into editor", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      const editor = screen.getByTestId("editor");
      expect(editor.textContent).toContain("Hello");
      expect(editor.textContent).toContain("Some content");
    });
  });

  it("displays page title", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("page-title")).toHaveValue("Hello");
    });
  });

  it("switches content on page change", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    const { unmount } = render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });
    unmount();

    useWorkspaceStore.setState({ currentPagePath: "Other.md" });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("page-title")).toHaveValue("Other");
      expect(screen.getByTestId("editor").textContent).toContain("Different content");
    });
  });

  it("calls writePage on edit (debounced 300ms)", async () => {
    vi.useFakeTimers();
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await vi.waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    const cmEditor = screen.getByTestId("editor").querySelector(".cm-editor");
    expect(cmEditor).not.toBeNull();

    // Simulate a user edit via CM6 view
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(cmEditor as HTMLElement);
    expect(view).not.toBeNull();

    act(() => {
      view!.dispatch({
        changes: { from: view!.state.doc.length, insert: " edited" },
      });
    });

    expect(writePageCalls).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(writePageCalls).toHaveLength(1);
    expect(writePageCalls[0]!.body).toContain("edited");

    vi.useRealTimers();
  });

  it("debounces rapid changes (single writePage call)", async () => {
    vi.useFakeTimers();
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await vi.waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    const cmEditor = screen.getByTestId("editor").querySelector(".cm-editor");
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(cmEditor as HTMLElement)!;

    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: "a" } });
    });
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: "b" } });
    });
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: "c" } });
    });
    await act(async () => { vi.advanceTimersByTime(300); });

    expect(writePageCalls).toHaveLength(1);

    vi.useRealTimers();
  });

  it("frontmatter toggle works", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTitle("Show frontmatter")).toBeInTheDocument();
    });

    await act(async () => {
      screen.getByTitle("Show frontmatter").click();
    });
    expect(screen.getByTestId("frontmatter")).toBeInTheDocument();
    const text = screen.getByTestId("frontmatter").textContent!;
    expect(text).toContain("test");
    expect(text).toContain("tags:");
    expect(text).not.toContain('"tags"');
  });
});

describe("frontmatter editing", () => {
  async function showFrontmatterPanel() {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByTitle("Show frontmatter")).toBeInTheDocument();
    });
    await act(async () => {
      screen.getByTitle("Show frontmatter").click();
    });
    expect(screen.getByTestId("frontmatter")).toBeInTheDocument();
  }

  it("clicking frontmatter enters edit mode with textarea", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    expect(screen.getByTestId("frontmatter-editor")).toBeInTheDocument();
  });

  it("textarea is pre-filled with rawYaml and focused", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    const textarea = screen.getByTestId("frontmatter-editor") as HTMLTextAreaElement;
    expect(textarea.value).toBe("tags:\n  - test\n");
    expect(document.activeElement).toBe(textarea);
  });

  it("Escape cancels without saving", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    const textarea = screen.getByTestId("frontmatter-editor");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "changed: true");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("frontmatter-editor")).not.toBeInTheDocument();
    expect(screen.getByTestId("frontmatter").textContent).toContain("tags:");
  });

  it("blur commits valid YAML and triggers save", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    const textarea = screen.getByTestId("frontmatter-editor");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "newtag: value");
    await act(async () => {
      textarea.blur();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("frontmatter-editor")).not.toBeInTheDocument();
    });
    expect(writePageCalls.length).toBeGreaterThan(0);
  });

  it("blur with invalid YAML shows error and stays in edit mode", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    const textarea = screen.getByTestId("frontmatter-editor");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "bad: {[}{[}{[}");
    await act(async () => {
      textarea.blur();
    });
    await waitFor(() => {
      expect(screen.getByTestId("yaml-error")).toBeInTheDocument();
    });
    const ta = screen.getByTestId("frontmatter-editor") as HTMLTextAreaElement;
    expect(ta).toBeInTheDocument();
    expect(ta.selectionStart).toBe(0);
    expect(ta.selectionEnd).toBe("bad: [[[".length);
  });

  it("YAML error selection works correctly with emoji in content", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    const textarea = screen.getByTestId("frontmatter-editor");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "🚀: {[}{[}{[}");
    await act(async () => {
      textarea.blur();
    });
    await waitFor(() => {
      expect(screen.getByTestId("yaml-error")).toBeInTheDocument();
    });
    const ta = screen.getByTestId("frontmatter-editor") as HTMLTextAreaElement;
    expect(ta.selectionStart).toBe(0);
    expect(ta.selectionEnd).toBe("🚀: [[[".length);
  });

  it("editing to empty commits empty frontmatter", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    const textarea = screen.getByTestId("frontmatter-editor");
    await userEvent.clear(textarea);
    await act(async () => {
      textarea.blur();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("frontmatter-editor")).not.toBeInTheDocument();
    });
  });

  it("page switch resets edit state", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    expect(screen.getByTestId("frontmatter-editor")).toBeInTheDocument();

    await act(async () => {
      useWorkspaceStore.setState({ currentPagePath: "Other.md" });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("frontmatter-editor")).not.toBeInTheDocument();
    });
  });
});

describe("ContentArea dirty tracking", () => {
  it("buffer is clean after page load", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });
    expect(useWorkspaceStore.getState().isDirty).toBe(false);
  });

  it("buffer becomes dirty on edit", async () => {
    vi.useFakeTimers();
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await vi.waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    const cmEditor = screen.getByTestId("editor").querySelector(".cm-editor");
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(cmEditor as HTMLElement)!;

    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: " dirty" } });
    });

    expect(useWorkspaceStore.getState().isDirty).toBe(true);
    vi.useRealTimers();
  });

  it("buffer becomes clean after debounced save", async () => {
    vi.useFakeTimers();
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await vi.waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    const cmEditor = screen.getByTestId("editor").querySelector(".cm-editor");
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(cmEditor as HTMLElement)!;

    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: " saved" } });
    });

    expect(useWorkspaceStore.getState().isDirty).toBe(true);

    await act(async () => { vi.advanceTimersByTime(300); });
    await vi.waitFor(() => {
      expect(useWorkspaceStore.getState().isDirty).toBe(false);
    });

    vi.useRealTimers();
  });

  it("rapid edits during writePage flight keep dirty flag", async () => {
    vi.useFakeTimers();
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await vi.waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    const cmEditor = screen.getByTestId("editor").querySelector(".cm-editor");
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(cmEditor as HTMLElement)!;

    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: "a" } });
    });

    await act(async () => { vi.advanceTimersByTime(300); });

    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: "b" } });
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(useWorkspaceStore.getState().isDirty).toBe(true);

    vi.useRealTimers();
  });
});

describe("ContentArea conflict handling", () => {
  it("auto-reloads when reloadTrigger increments and buffer is clean", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    expect(useWorkspaceStore.getState().isDirty).toBe(false);

    act(() => {
      useWorkspaceStore.getState().triggerReload();
    });

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });
    expect(screen.queryByTestId("conflict-dialog")).not.toBeInTheDocument();
  });

  it("shows conflict dialog when reloadTrigger increments and buffer is dirty", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    act(() => {
      useWorkspaceStore.getState().setDirty(true);
    });

    act(() => {
      useWorkspaceStore.getState().triggerReload();
    });

    await waitFor(() => {
      expect(screen.getByTestId("conflict-dialog")).toBeInTheDocument();
    });
  });

  it("Keep Mine dismisses dialog, keeps local content", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    act(() => {
      useWorkspaceStore.getState().setDirty(true);
    });
    act(() => {
      useWorkspaceStore.getState().triggerReload();
    });

    await waitFor(() => {
      expect(screen.getByTestId("conflict-dialog")).toBeInTheDocument();
    });

    act(() => {
      screen.getByTestId("conflict-keep-mine").click();
    });

    expect(screen.queryByTestId("conflict-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor").textContent).toContain("Some content");
  });

  it("Reload dismisses dialog, loads disk content, clears dirty", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    act(() => {
      useWorkspaceStore.getState().setDirty(true);
    });
    act(() => {
      useWorkspaceStore.getState().triggerReload();
    });

    await waitFor(() => {
      expect(screen.getByTestId("conflict-dialog")).toBeInTheDocument();
    });

    act(() => {
      screen.getByTestId("conflict-reload").click();
    });

    expect(screen.queryByTestId("conflict-dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(useWorkspaceStore.getState().isDirty).toBe(false);
    });
  });

  it("page switch dismisses conflict dialog", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    act(() => {
      useWorkspaceStore.getState().setDirty(true);
    });
    act(() => {
      useWorkspaceStore.getState().triggerReload();
    });

    await waitFor(() => {
      expect(screen.getByTestId("conflict-dialog")).toBeInTheDocument();
    });

    act(() => {
      useWorkspaceStore.getState().selectPage("Other.md");
    });

    await waitFor(() => {
      expect(screen.queryByTestId("conflict-dialog")).not.toBeInTheDocument();
    });
  });
});

describe("ContentArea headings", () => {
  it("after page load, store has correct headings", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      const headings = useWorkspaceStore.getState().currentPageHeadings;
      expect(headings).toEqual([
        { level: 1, text: "Hello", line: 0, from: 0, to: 7 },
      ]);
    });
  });

  it("when no page selected, headings are []", () => {
    render(<ContentArea />);
    expect(useWorkspaceStore.getState().currentPageHeadings).toEqual([]);
  });
});

describe("ContentArea scroll position", () => {
  it("saves scroll position on page switch", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    act(() => {
      useWorkspaceStore.getState().selectPage("Other.md");
    });

    await waitFor(() => {
      const vs = useWorkspaceStore.getState().viewStates["Hello.md"];
      expect(vs).toBeDefined();
      expect(vs!.scrollTop).toBeDefined();
      expect(vs!.cursor).toBeDefined();
    });
  });

  it("no save when switching from null", async () => {
    render(<ContentArea />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();

    act(() => {
      useWorkspaceStore.getState().selectPage("Hello.md");
    });

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    expect(useWorkspaceStore.getState().viewStates).toEqual({});
  });

  it("saves when deselecting to null", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    act(() => {
      useWorkspaceStore.getState().selectPage(null);
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("selectPage(null)"),
      expect.anything(),
    );
    warnSpy.mockRestore();

    await waitFor(() => {
      expect(useWorkspaceStore.getState().viewStates["Hello.md"]).toBeDefined();
    });
  });

  it("saves cursor position on page switch", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    const cmEditor = screen.getByTestId("editor").querySelector(".cm-editor");
    const { EditorView } = await import("@codemirror/view");
    const { EditorSelection } = await import("@codemirror/state");
    const view = EditorView.findFromDOM(cmEditor as HTMLElement)!;

    act(() => {
      view.dispatch({ selection: EditorSelection.cursor(5) });
    });

    act(() => {
      useWorkspaceStore.getState().selectPage("Other.md");
    });

    await waitFor(() => {
      expect(useWorkspaceStore.getState().viewStates["Hello.md"]?.cursor).toBe(5);
    });
  });

  it("pendingCursorLine scroll uses y:'center'", async () => {
    const { EditorView } = await import("@codemirror/view");
    const spy = vi.spyOn(EditorView, "scrollIntoView");

    useWorkspaceStore.setState({
      currentPagePath: "Hello.md",
      pendingCursorLine: 2,
      pendingCursorCol: 0,
    });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    await waitFor(() => {
      const centerCalls = spy.mock.calls.filter(
        (args) => args[1] && (args[1] as Record<string, unknown>).y === "center",
      );
      expect(centerCalls.length).toBeGreaterThanOrEqual(1);
    });

    spy.mockRestore();
  });

  it("pendingCursorLine with fileAbsolute adjusts for frontmatter", async () => {
    const { EditorView } = await import("@codemirror/view");

    // samplePage has raw_yaml "tags:\n  - test\n" → 2 YAML lines + 2 fences = 4 line offset
    // File line 6 should become body line 2
    useWorkspaceStore.setState({
      currentPagePath: "Hello.md",
      pendingCursorLine: 6,
      pendingCursorCol: 0,
      pendingCursorFileAbsolute: true,
    });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    const cmEditor = screen.getByTestId("editor").querySelector(".cm-editor");
    const view = EditorView.findFromDOM(cmEditor as HTMLElement)!;

    await waitFor(() => {
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      expect(line.number).toBe(2);
    });
  });

  it("pendingCursorLine with fileAbsolute and no frontmatter passes through unchanged", async () => {
    const { EditorView } = await import("@codemirror/view");

    // otherPage has raw_yaml "" → no offset, line 2 stays line 2
    useWorkspaceStore.setState({
      currentPagePath: "Other.md",
      pendingCursorLine: 2,
      pendingCursorCol: 0,
      pendingCursorFileAbsolute: true,
    });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Different content");
    });

    const cmEditor = screen.getByTestId("editor").querySelector(".cm-editor");
    const view = EditorView.findFromDOM(cmEditor as HTMLElement)!;

    await waitFor(() => {
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      expect(line.number).toBe(2);
    });
  });
});

describe("parseYamlErrorLocation", () => {
  it("parses 'at line X column Y' at end of message", () => {
    expect(
      parseYamlErrorLocation("mapping values are not allowed in this context at line 1 column 8"),
    ).toEqual({ line: 1, column: 8 });
  });

  it("prefers 'while parsing' origin location over detection location", () => {
    expect(
      parseYamlErrorLocation(
        "did not find expected ',' or ']' at line 2 column 1, while parsing a flow sequence at line 1 column 6",
      ),
    ).toEqual({ line: 1, column: 6 });
  });

  it("parses multi-digit line and column", () => {
    expect(
      parseYamlErrorLocation("something went wrong at line 123 column 45"),
    ).toEqual({ line: 123, column: 45 });
  });

  it("returns null for messages without location", () => {
    expect(
      parseYamlErrorLocation("invalid type: sequence, expected a map"),
    ).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseYamlErrorLocation("")).toBeNull();
  });
});

const multiHeadingPage = {
  body: "# First\nContent\n## Second\nMore",
  raw_yaml: "",
  meta: {
    title: "First",
    frontmatter: {},
    relative_path: "Multi.md",
    created_at: 1000,
    modified_at: 2000,
    file_type: 'markdown' as const,
  },
};

describe("ContentArea mindmap toggle", () => {
  it("toggle button switches between editor and mindmap views", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    const user = userEvent.setup();
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("mindmap-view")).not.toBeInTheDocument();

    const mindmapBtn = screen.getByRole("button", { name: /mindmap/i });
    await user.click(mindmapBtn);
    expect(screen.getByTestId("editor")).not.toBeVisible();
    await waitFor(() => {
      expect(screen.getByTestId("mindmap-view")).toBeInTheDocument();
    });

    const editorBtn = screen.getByRole("button", { name: /editor/i });
    await user.click(editorBtn);
    expect(screen.getByTestId("editor")).toBeVisible();
    expect(screen.queryByTestId("mindmap-view")).not.toBeInTheDocument();
  });

  it("clicking a mindmap node scrolls editor to the heading line", async () => {
    mockInvoke((cmd, args) => {
      if (cmd === "read_page") {
        const rp = (args as Record<string, unknown>)?.relativePath;
        if (rp === "Multi.md") return multiHeadingPage;
        return samplePage;
      }
      if (cmd === "write_page") return null;
      if (cmd === "parse_raw_yaml") return {};
      if (cmd === "get_backlinks") return [];
      if (cmd === "get_keymaps") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    useWorkspaceStore.setState({ currentPagePath: "Multi.md" });
    const user = userEvent.setup();
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });

    // Switch to mindmap
    const mindmapBtn = screen.getByRole("button", { name: /mindmap/i });
    await user.click(mindmapBtn);
    await waitFor(() => {
      expect(screen.getByTestId("mindmap-view")).toBeInTheDocument();
    });

    // Wait for lazy MindmapView to load (past Suspense fallback)
    const { within } = await import("@testing-library/react");
    const mindmapContainer = screen.getByTestId("mindmap-view");
    let secondNode!: HTMLElement;
    await waitFor(() => {
      secondNode = within(mindmapContainer).getByText("Second");
    });
    await user.click(secondNode);

    // Editor is always mounted (hidden via display:none), viewMode switches back
    const cmEditor = screen.getByTestId("editor").querySelector(".cm-editor");
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(cmEditor as HTMLElement)!;

    // "# First\nContent\n## Second\nMore" — "## Second" starts at position 16
    await waitFor(() => {
      expect(view.state.selection.main.head).toBe(16);
    });
  });
});

describe("ContentArea bottom panel", () => {
  beforeEach(() => {
    mockInvoke((cmd) => {
      if (cmd === "read_page") return samplePage;
      if (cmd === "write_page") return null;
      if (cmd === "parse_raw_yaml") return {};
      if (cmd === "get_backlinks") return [];
      if (cmd === "get_keymaps") return [];
      if (cmd === "get_unlinked_mentions") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  it("renders BottomPanel with pageId", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("bottom-panel")).toBeInTheDocument();
    });
  });
});

describe("ContentArea jump recording on page switch", () => {
  beforeEach(() => {
    globalJumpTracker.clear();
  });

  it("records departure jump when switching pages via selectPage", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    act(() => {
      useWorkspaceStore.getState().selectPage("Other.md");
    });

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Different content");
    });

    expect(globalJumpTracker.jumps.length).toBeGreaterThanOrEqual(1);
    expect(globalJumpTracker.jumps.some((j) => j.notePath === "Hello.md")).toBe(true);
  });

  it("does not record departure when switching from null (no previous page)", async () => {
    render(<ContentArea />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();

    act(() => {
      useWorkspaceStore.getState().selectPage("Hello.md");
    });

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    expect(globalJumpTracker.jumps).toHaveLength(0);
  });

  it("does not record departure when isNavigating is true (jump navigation)", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    globalJumpTracker.isNavigating = true;

    act(() => {
      useWorkspaceStore.getState().selectPage("Other.md");
    });

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Different content");
    });

    expect(globalJumpTracker.jumps).toHaveLength(0);
    globalJumpTracker.isNavigating = false;
  });
});

describe("ContentArea menu://open-in-external-editor", () => {
  beforeEach(() => {
    resetListenMock();
    mockListen();
  });

  it("delegates to commandRegistry.execute with the editor view", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    const spy = vi.spyOn(commandRegistry, "execute").mockReturnValue(true);
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    act(() => {
      emitMockEvent("menu://open-in-external-editor", {});
    });

    expect(spy).toHaveBeenCalledWith(
      "editor.openInExternalEditor",
      expect.any(Object),
    );
    spy.mockRestore();
  });

  it("does not call commandRegistry.execute when no editor view", async () => {
    const spy = vi.spyOn(commandRegistry, "execute");
    render(<ContentArea />);

    expect(screen.getByTestId("empty-state")).toBeInTheDocument();

    act(() => {
      emitMockEvent("menu://open-in-external-editor", {});
    });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
