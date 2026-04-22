import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { ContentArea } from "./ContentArea";
import { mockInvoke } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";

const samplePage = {
  body: "# Hello\nSome content",
  raw_yaml: "tags:\n  - test\n",
  meta: {
    title: "Hello",
    frontmatter: { tags: ["test"] },
    relative_path: "Hello.md",
    created_at: 1000,
    modified_at: 2000,
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
  },
};

let writePageCalls: Array<{ path: string; body: string }> = [];

beforeEach(() => {
  writePageCalls = [];
  useWorkspaceStore.setState({
    workspacePath: "/test",
    pages: [],
    currentPagePath: null,
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
      expect(screen.getByText("Show frontmatter")).toBeInTheDocument();
    });

    await act(async () => {
      screen.getByText("Show frontmatter").click();
    });
    expect(screen.getByTestId("frontmatter")).toBeInTheDocument();
    const text = screen.getByTestId("frontmatter").textContent!;
    expect(text).toContain("test");
    expect(text).toContain("tags:");
    expect(text).not.toContain('"tags"');
  });
});
