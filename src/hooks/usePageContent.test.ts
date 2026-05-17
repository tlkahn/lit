import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { mockInvoke, resetInvokeMock } from "../test/tauri-mock";
import {
  getPaneContent,
  _resetForTesting,
} from "../lib/paneContentRegistry";
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
  resetInvokeMock();
  mockInvoke((cmd) => {
    if (cmd === "read_page") return mockPage;
    if (cmd === "write_page") return null;
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

  it("resets state when pagePath changes", async () => {
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

    const { result, rerender } = renderHook(
      ({ path }) => usePageContent("p1", path),
      { initialProps: { path: "hello.md" as string | null } },
    );

    await waitFor(() => {
      expect(result.current.body).toBe("# Hello\nContent here");
    });

    rerender({ path: "world.md" });

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

  it("cancels pending debounce on unmount", async () => {
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

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(writeCalls).toHaveLength(0);
  });
});
