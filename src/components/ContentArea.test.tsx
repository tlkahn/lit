import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentArea, parseYamlErrorLocation } from "./ContentArea";
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
    currentPageHeadings: [],
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

describe("frontmatter editing", () => {
  async function showFrontmatterPanel() {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByText("Show frontmatter")).toBeInTheDocument();
    });
    await act(async () => {
      screen.getByText("Show frontmatter").click();
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

describe("ContentArea headings", () => {
  it("after page load, store has correct headings", async () => {
    useWorkspaceStore.setState({ currentPagePath: "Hello.md" });
    render(<ContentArea />);

    await waitFor(() => {
      const headings = useWorkspaceStore.getState().currentPageHeadings;
      expect(headings).toEqual([
        { level: 1, text: "Hello", line: 0 },
      ]);
    });
  });

  it("when no page selected, headings are []", () => {
    render(<ContentArea />);
    expect(useWorkspaceStore.getState().currentPageHeadings).toEqual([]);
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
