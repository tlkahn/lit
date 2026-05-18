import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { mockInvoke, resetInvokeMock } from "../test/tauri-mock";
import {
  getPaneContent,
  _resetForTesting,
} from "../lib/paneContentRegistry";
import { _resetForTesting as resetSharedDocs, getPaneIds } from "../lib/sharedDocs";
import { useWorkspaceStore } from "../stores/workspace";
import { usePageContent } from "./usePageContent";

const mockPage = {
  meta: {
    title: "Hello",
    relative_path: "hello.md",
    frontmatter: { tags: ["test"] },
    created_at: null,
    modified_at: null,
    file_type: "markdown",
  },
  body: "# Hello\nContent here",
  raw_yaml: "tags:\n  - test\n",
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  _resetForTesting();
  resetSharedDocs();
  resetInvokeMock();
  useWorkspaceStore.setState({
    currentPageHeadings: [],
    isDirty: false,
    reloadTrigger: 0,
    viewStates: {},
  });
  mockInvoke((cmd) => {
    if (cmd === "read_page") return mockPage;
    if (cmd === "write_page") return null;
    if (cmd === "acknowledge_file_hash") return null;
    return null;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePageContent", () => {
  it("returns empty state when pagePath is null", () => {
    const { result } = renderHook(() => usePageContent("p1", null));

    expect(result.current.body).toBe("");
    expect(result.current.title).toBe("");
    expect(result.current.frontmatter).toEqual({});
    expect(result.current.rawYaml).toBe("");
    expect(result.current.isDirty).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(getPaneContent("p1")).toBeNull();
  });

  it("loads page content when pagePath provided", async () => {
    const { result } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(result.current.body).toBe("# Hello\nContent here");
    });
    expect(result.current.title).toBe("Hello");
    expect(result.current.frontmatter).toEqual({ tags: ["test"] });
    expect(result.current.rawYaml).toBe("tags:\n  - test\n");
  });

  it("registers content in paneContentRegistry on load", async () => {
    const { result } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(result.current.body).toBe("# Hello\nContent here");
    });

    const entry = getPaneContent("p1");
    expect(entry).not.toBeNull();
    expect(entry!.title).toBe("Hello");
    expect(entry!.frontmatter).toEqual({ tags: ["test"] });
    expect(entry!.rawYaml).toBe("tags:\n  - test\n");
  });

  it("handleChange sets body, marks dirty, saves after 300ms", async () => {
    const writeCalls: unknown[] = [];
    mockInvoke((cmd, args) => {
      if (cmd === "read_page") return mockPage;
      if (cmd === "write_page") {
        writeCalls.push(args);
        return null;
      }
      return null;
    });

    const { result } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(result.current.body).toBe("# Hello\nContent here");
    });

    act(() => {
      result.current.handleChange("new body");
    });

    expect(result.current.body).toBe("new body");
    expect(result.current.isDirty).toBe(true);
    expect(writeCalls).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]).toMatchObject({
      relativePath: "hello.md",
      body: "new body",
      frontmatter: { tags: ["test"] },
    });
  });

  it("debounces rapid changes — single writePage", async () => {
    const writeCalls: unknown[] = [];
    mockInvoke((cmd, args) => {
      if (cmd === "read_page") return mockPage;
      if (cmd === "write_page") {
        writeCalls.push(args);
        return null;
      }
      return null;
    });

    const { result } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(result.current.body).toBe("# Hello\nContent here");
    });

    act(() => {
      result.current.handleChange("body1");
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    act(() => {
      result.current.handleChange("body2");
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    act(() => {
      result.current.handleChange("body3");
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]).toMatchObject({ body: "body3" });
  });

  it("isDirty clears after successful save, stays true if edited during flight", async () => {
    let writeResolve: (() => void) | null = null;
    mockInvoke((cmd) => {
      if (cmd === "read_page") return mockPage;
      if (cmd === "write_page") {
        return new Promise<null>((resolve) => {
          writeResolve = () => resolve(null);
        });
      }
      return null;
    });

    const { result } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(result.current.body).toBe("# Hello\nContent here");
    });

    act(() => {
      result.current.handleChange("edit1");
    });
    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      result.current.handleChange("edit2");
    });

    await act(async () => {
      writeResolve!();
    });

    expect(result.current.isDirty).toBe(true);
  });

  it("resets state when pagePath changes and flushes old-path save", async () => {
    const writeCalls: Record<string, unknown>[] = [];
    const mockPage2 = {
      meta: {
        title: "World",
        relative_path: "world.md",
        frontmatter: { draft: true },
        created_at: null,
        modified_at: null,
        file_type: "markdown",
      },
      body: "# World\nAnother page",
      raw_yaml: "draft: true\n",
    };

    mockInvoke((cmd, args) => {
      if (cmd === "read_page") {
        const path = (args as Record<string, unknown>).relativePath;
        return path === "world.md" ? mockPage2 : mockPage;
      }
      if (cmd === "write_page") {
        writeCalls.push(args as Record<string, unknown>);
        return null;
      }
      return null;
    });

    const { result, rerender } = renderHook(
      ({ path }) => usePageContent("p1", path),
      { initialProps: { path: "hello.md" as string | null } },
    );

    await waitFor(() => {
      expect(result.current.body).toBe("# Hello\nContent here");
    });

    act(() => {
      result.current.handleChange("old path edit");
    });

    rerender({ path: "world.md" });

    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]).toMatchObject({
      relativePath: "hello.md",
      body: "old path edit",
    });

    await waitFor(() => {
      expect(result.current.body).toBe("# World\nAnother page");
    });
    expect(result.current.title).toBe("World");
    expect(result.current.frontmatter).toEqual({ draft: true });
  });

  it("stale readPage response ignored", async () => {
    let resolveA: ((v: typeof mockPage) => void) | null = null;

    const mockPageB = {
      meta: {
        title: "PageB",
        relative_path: "b.md",
        frontmatter: {},
        created_at: null,
        modified_at: null,
        file_type: "markdown",
      },
      body: "B content",
      raw_yaml: "",
    };

    mockInvoke((cmd, args) => {
      if (cmd === "read_page") {
        const path = (args as Record<string, unknown>).relativePath;
        if (path === "a.md") {
          return new Promise((resolve) => {
            resolveA = resolve;
          });
        }
        return mockPageB;
      }
      return null;
    });

    const { result, rerender } = renderHook(
      ({ path }) => usePageContent("p1", path),
      { initialProps: { path: "a.md" as string | null } },
    );

    rerender({ path: "b.md" });

    await waitFor(() => {
      expect(result.current.body).toBe("B content");
    });

    await act(async () => {
      resolveA!(mockPage);
    });

    expect(result.current.body).toBe("B content");
    expect(result.current.title).toBe("PageB");
  });

  it("unregisters from paneContentRegistry on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      usePageContent("p1", "hello.md"),
    );

    await waitFor(() => {
      expect(result.current.body).toBe("# Hello\nContent here");
    });

    expect(getPaneContent("p1")).not.toBeNull();

    unmount();

    expect(getPaneContent("p1")).toBeNull();
  });

  it("flushes pending save on unmount of last pane", async () => {
    const writeCalls: unknown[] = [];
    mockInvoke((cmd, args) => {
      if (cmd === "read_page") return mockPage;
      if (cmd === "write_page") {
        writeCalls.push(args);
        return null;
      }
      return null;
    });

    const { result, unmount } = renderHook(() =>
      usePageContent("p1", "hello.md"),
    );

    await waitFor(() => {
      expect(result.current.body).toBe("# Hello\nContent here");
    });

    act(() => {
      result.current.handleChange("unsaved edit");
    });

    unmount();

    expect(writeCalls).toHaveLength(1);
  });

  it("body appears in registry after readPage", async () => {
    const { result } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(result.current.body).toBe("# Hello\nContent here");
    });

    const entry = getPaneContent("p1");
    expect(entry).not.toBeNull();
    expect(entry!.body).toBe("# Hello\nContent here");
  });

  it("body updates in registry on handleChange", async () => {
    const { result } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(result.current.body).toBe("# Hello\nContent here");
    });

    act(() => {
      result.current.handleChange("new body");
    });

    const entry = getPaneContent("p1");
    expect(entry!.body).toBe("new body");
  });

  it("sets headings on initial load (immediate)", async () => {
    renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      const headings = useWorkspaceStore.getState().currentPageHeadings;
      expect(headings).toEqual([
        { level: 1, text: "Hello", line: 0, from: 0, to: 7 },
      ]);
    });
  });

  it("updates headings on handleChange (debounced 150ms)", async () => {
    const { result } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(result.current.body).toBe("# Hello\nContent here");
    });

    act(() => {
      result.current.handleChange("# New Title\n## Sub");
    });

    // Not yet updated (debounced)
    const headingsBefore = useWorkspaceStore.getState().currentPageHeadings;
    expect(headingsBefore).toEqual([
      { level: 1, text: "Hello", line: 0, from: 0, to: 7 },
    ]);

    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    const headingsAfter = useWorkspaceStore.getState().currentPageHeadings;
    expect(headingsAfter).toHaveLength(2);
    expect(headingsAfter[0]!.text).toBe("New Title");
    expect(headingsAfter[1]!.text).toBe("Sub");
  });

  it("reload trigger re-reads page when clean", async () => {
    let readCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "read_page") {
        readCount++;
        return mockPage;
      }
      if (cmd === "write_page") return null;
      if (cmd === "acknowledge_file_hash") return null;
      return null;
    });

    renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(readCount).toBe(1);
    });

    act(() => {
      useWorkspaceStore.getState().triggerReload();
    });

    await waitFor(() => {
      expect(readCount).toBe(2);
    });
  });

  it("reload trigger acknowledges when dirty", async () => {
    mockInvoke((cmd) => {
      if (cmd === "read_page") return mockPage;
      if (cmd === "write_page") return null;
      if (cmd === "acknowledge_file_hash") return null;
      return null;
    });

    renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("read_page", expect.anything());
    });

    act(() => {
      useWorkspaceStore.setState({ isDirty: true });
    });

    act(() => {
      useWorkspaceStore.getState().triggerReload();
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("acknowledge_file_hash", { relativePath: "hello.md" });
    });
  });

  it("handleChange sets workspace store isDirty", async () => {
    const { result } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(result.current.body).toBe("# Hello\nContent here");
    });

    expect(useWorkspaceStore.getState().isDirty).toBe(false);

    act(() => {
      result.current.handleChange("x");
    });

    expect(useWorkspaceStore.getState().isDirty).toBe(true);
  });

  it("successful save clears workspace store isDirty", async () => {
    const { result } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(result.current.body).toBe("# Hello\nContent here");
    });

    act(() => {
      result.current.handleChange("x");
    });

    expect(useWorkspaceStore.getState().isDirty).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(useWorkspaceStore.getState().isDirty).toBe(false);
    });
  });

  it("reload acknowledges when hook has unsaved edits", async () => {
    let readCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "read_page") {
        readCount++;
        return mockPage;
      }
      if (cmd === "write_page") return null;
      if (cmd === "acknowledge_file_hash") return null;
      return null;
    });

    const { result } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(readCount).toBe(1);
    });

    act(() => {
      result.current.handleChange("x");
    });

    act(() => {
      useWorkspaceStore.getState().triggerReload();
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("acknowledge_file_hash", { relativePath: "hello.md" });
    });

    expect(readCount).toBe(1);
  });

  it("second pane on same file skips readPage", async () => {
    let readCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "read_page") {
        readCount++;
        return mockPage;
      }
      if (cmd === "write_page") return null;
      return null;
    });

    const { result: r1 } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(r1.current.body).toBe("# Hello\nContent here");
    });
    expect(readCount).toBe(1);

    const { result: r2 } = renderHook(() => usePageContent("p2", "hello.md"));

    await waitFor(() => {
      expect(r2.current.body).toBe("# Hello\nContent here");
    });
    expect(readCount).toBe(1);

    expect(r2.current.title).toBe("Hello");
    expect(r2.current.frontmatter).toEqual({ tags: ["test"] });
    expect(r2.current.rawYaml).toBe("tags:\n  - test\n");
  });

  it("edit in pane A propagates to pane B", async () => {
    const { result: r1 } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(r1.current.body).toBe("# Hello\nContent here");
    });

    const { result: r2 } = renderHook(() => usePageContent("p2", "hello.md"));

    await waitFor(() => {
      expect(r2.current.body).toBe("# Hello\nContent here");
    });

    act(() => {
      r1.current.handleChange("edited by p1");
    });

    expect(r2.current.body).toBe("edited by p1");
  });

  it("two panes share a single save — no duplicate writePage", async () => {
    const writeCalls: unknown[] = [];
    mockInvoke((cmd, args) => {
      if (cmd === "read_page") return mockPage;
      if (cmd === "write_page") {
        writeCalls.push(args);
        return null;
      }
      return null;
    });

    const { result: r1 } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(r1.current.body).toBe("# Hello\nContent here");
    });

    const { result: r2 } = renderHook(() => usePageContent("p2", "hello.md"));

    await waitFor(() => {
      expect(r2.current.body).toBe("# Hello\nContent here");
    });

    act(() => {
      r1.current.handleChange("from p1");
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(writeCalls).toHaveLength(1);

    writeCalls.length = 0;

    act(() => {
      r1.current.handleChange("from p1 again");
    });

    act(() => {
      r2.current.handleChange("from p2");
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]).toMatchObject({ body: "from p2" });
  });

  it("pane navigates to different page — releases old, acquires new", async () => {
    const mockPage2 = {
      meta: {
        title: "World",
        relative_path: "world.md",
        frontmatter: { draft: true },
        created_at: null,
        modified_at: null,
        file_type: "markdown",
      },
      body: "# World\nAnother page",
      raw_yaml: "draft: true\n",
    };

    mockInvoke((cmd, args) => {
      if (cmd === "read_page") {
        const path = (args as Record<string, unknown>).relativePath;
        return path === "world.md" ? mockPage2 : mockPage;
      }
      if (cmd === "write_page") return null;
      return null;
    });

    const { result: r1 } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(r1.current.body).toBe("# Hello\nContent here");
    });

    const { result: r2, rerender: rerenderP2 } = renderHook(
      ({ path }) => usePageContent("p2", path),
      { initialProps: { path: "hello.md" as string | null } },
    );

    await waitFor(() => {
      expect(r2.current.body).toBe("# Hello\nContent here");
    });

    rerenderP2({ path: "world.md" });

    await waitFor(() => {
      expect(r2.current.body).toBe("# World\nAnother page");
    });

    expect(getPaneIds("hello.md")).toEqual(["p1"]);
    expect(getPaneIds("world.md")).toEqual(["p2"]);

    act(() => {
      r1.current.handleChange("edit in p1");
    });
    expect(r2.current.body).toBe("# World\nAnother page");
  });

  it("unmount last pane flushes pending save", async () => {
    const writeCalls: unknown[] = [];
    mockInvoke((cmd, args) => {
      if (cmd === "read_page") return mockPage;
      if (cmd === "write_page") {
        writeCalls.push(args);
        return null;
      }
      return null;
    });

    const { result: r1, unmount: unmount1 } = renderHook(() =>
      usePageContent("p1", "hello.md"),
    );

    await waitFor(() => {
      expect(r1.current.body).toBe("# Hello\nContent here");
    });

    const { result: r2, unmount: unmount2 } = renderHook(() =>
      usePageContent("p2", "hello.md"),
    );

    await waitFor(() => {
      expect(r2.current.body).toBe("# Hello\nContent here");
    });

    act(() => {
      r1.current.handleChange("unsaved");
    });

    unmount2();
    expect(writeCalls).toHaveLength(0);

    unmount1();
    expect(writeCalls).toHaveLength(1);
  });

  it("siblingUpdateRef tracks cross-pane vs own updates", async () => {
    const { result: r1 } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(r1.current.body).toBe("# Hello\nContent here");
    });

    const { result: r2 } = renderHook(() => usePageContent("p2", "hello.md"));

    await waitFor(() => {
      expect(r2.current.body).toBe("# Hello\nContent here");
    });

    expect(r2.current.siblingUpdateRef.current).toBe(false);

    act(() => {
      r1.current.handleChange("from p1");
    });
    expect(r2.current.siblingUpdateRef.current).toBe(true);

    act(() => {
      r2.current.handleChange("own edit");
    });
    expect(r2.current.siblingUpdateRef.current).toBe(false);
  });

  it("siblingUpdateRef is false after initial readPage load", async () => {
    const { result } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(result.current.body).toBe("# Hello\nContent here");
    });

    expect(result.current.siblingUpdateRef.current).toBe(false);
  });

  it("second pane on blank page uses cache (no redundant readPage)", async () => {
    const blankPage = {
      meta: {
        title: "Blank",
        relative_path: "blank.md",
        frontmatter: {},
        created_at: null,
        modified_at: null,
        file_type: "markdown",
      },
      body: "",
      raw_yaml: "",
    };

    let readCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "read_page") {
        readCount++;
        return blankPage;
      }
      if (cmd === "write_page") return null;
      return null;
    });

    const { result: r1 } = renderHook(() => usePageContent("p1", "blank.md"));

    await waitFor(() => {
      expect(r1.current.title).toBe("Blank");
    });
    expect(readCount).toBe(1);

    const { result: r2 } = renderHook(() => usePageContent("p2", "blank.md"));

    await waitFor(() => {
      expect(r2.current.title).toBe("Blank");
    });
    expect(readCount).toBe(1);

    expect(r2.current.body).toBe("");
    expect(r2.current.frontmatter).toEqual({});
    expect(r2.current.rawYaml).toBe("");
  });

  it("reload with two panes only triggers one readPage and both panes update", async () => {
    const reloadPage = {
      meta: {
        title: "Hello",
        relative_path: "hello.md",
        frontmatter: { tags: ["test"] },
        created_at: null,
        modified_at: null,
        file_type: "markdown",
      },
      body: "# Hello\nReloaded content",
      raw_yaml: "tags:\n  - test\n",
    };

    let readCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "read_page") {
        readCount++;
        return readCount === 1 ? mockPage : reloadPage;
      }
      if (cmd === "write_page") return null;
      if (cmd === "acknowledge_file_hash") return null;
      return null;
    });

    const { result: r1 } = renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(r1.current.body).toBe("# Hello\nContent here");
    });
    expect(readCount).toBe(1);

    const { result: r2 } = renderHook(() => usePageContent("p2", "hello.md"));

    await waitFor(() => {
      expect(r2.current.body).toBe("# Hello\nContent here");
    });
    expect(readCount).toBe(1);

    act(() => {
      useWorkspaceStore.getState().triggerReload();
    });

    await waitFor(() => {
      expect(r1.current.body).toBe("# Hello\nReloaded content");
    });

    await waitFor(() => {
      expect(r2.current.body).toBe("# Hello\nReloaded content");
    });

    expect(readCount).toBe(2);
  });

  it("reload updates currentFrontmatterLineCount", async () => {
    const reloadPage = {
      meta: {
        title: "Hello",
        relative_path: "hello.md",
        frontmatter: { tags: ["test"], draft: true },
        created_at: null,
        modified_at: null,
        file_type: "markdown",
      },
      body: "# Hello\nContent here",
      raw_yaml: "tags:\n  - test\ndraft: true\n",
    };

    let readCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "read_page") {
        readCount++;
        return readCount === 1 ? mockPage : reloadPage;
      }
      if (cmd === "write_page") return null;
      if (cmd === "acknowledge_file_hash") return null;
      return null;
    });

    renderHook(() => usePageContent("p1", "hello.md"));

    await waitFor(() => {
      expect(readCount).toBe(1);
    });

    // Initial load: "tags:\n  - test\n" → 2 content lines + 2 delimiters = 4
    expect(useWorkspaceStore.getState().currentFrontmatterLineCount).toBe(4);

    act(() => {
      useWorkspaceStore.getState().triggerReload();
    });

    await waitFor(() => {
      expect(readCount).toBe(2);
    });

    // Reload: "tags:\n  - test\ndraft: true\n" → 3 content lines + 2 delimiters = 5
    expect(useWorkspaceStore.getState().currentFrontmatterLineCount).toBe(5);
  });
});
