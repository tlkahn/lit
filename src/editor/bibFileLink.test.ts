import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { BIB_FIELD_RE, bibFileLinkExtension, bibFileLinkPlugin, bibPagePathFacet } from "./bibFileLink";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getFileDir, isAbsolutePath, resolveRelativePath } from "../lib/pathUtils";
import { useWorkspaceStore } from "../stores/workspace";
import { useStatusMessageStore } from "../stores/statusMessage";

vi.mock("../stores/workspace", () => ({
  useWorkspaceStore: {
    getState: vi.fn(() => ({
      selectPage: vi.fn(),
      pages: [],
    })),
    setState: vi.fn((partial: Record<string, unknown>) => {
      const current = (useWorkspaceStore.getState as ReturnType<typeof vi.fn>)();
      (useWorkspaceStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        ...current,
        ...partial,
      });
    }),
  },
}));

vi.mock("../stores/statusMessage", () => ({
  useStatusMessageStore: {
    getState: vi.fn(() => ({
      show: vi.fn(),
    })),
  },
}));

function extractPaths(text: string): string[] {
  BIB_FIELD_RE.lastIndex = 0;
  const paths: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = BIB_FIELD_RE.exec(text)) !== null) {
    if (m[1]!.toLowerCase() === "file") {
      paths.push((m[2] ?? m[3])!);
    }
  }
  return paths;
}

describe("BIB_FIELD_RE — file fields", () => {
  it("matches file = {path}", () => {
    expect(extractPaths("file = {assets/pdf/foo.pdf}")).toEqual([
      "assets/pdf/foo.pdf",
    ]);
  });

  it("matches with no spaces around =", () => {
    expect(extractPaths("file={bar.pdf}")).toEqual(["bar.pdf"]);
  });

  it("matches with extra spaces around =", () => {
    expect(extractPaths("file  =  {baz/doc.pdf}")).toEqual(["baz/doc.pdf"]);
  });

  it("matches multiple file fields", () => {
    const text = [
      "file = {a.pdf},",
      "title = {Hello},",
      "file = {b.pdf},",
    ].join("\n");
    expect(extractPaths(text)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("matches path with spaces", () => {
    expect(extractPaths("file = {my papers/file name.pdf}")).toEqual([
      "my papers/file name.pdf",
    ]);
  });

  it("does not match other fields", () => {
    expect(extractPaths("title = {Some Title}")).toEqual([]);
    expect(extractPaths("url = {https://example.com}")).toEqual([]);
  });

  it("does not match field names ending in 'file'", () => {
    expect(extractPaths("pdffile = {x.pdf}")).toEqual([]);
    expect(extractPaths("profilefile = {y.pdf}")).toEqual([]);
  });

  it("matches file = \"path\" (double-quoted)", () => {
    expect(extractPaths('file = "assets/pdf/foo.pdf"')).toEqual([
      "assets/pdf/foo.pdf",
    ]);
  });

  it("matches quoted form with no spaces around =", () => {
    expect(extractPaths('file="bar.pdf"')).toEqual(["bar.pdf"]);
  });

  it("matches file preceded by comma and whitespace", () => {
    expect(extractPaths("  file = {doc.pdf}")).toEqual(["doc.pdf"]);
  });

  it("truncates at first closing brace (known limitation: no nested brace support)", () => {
    // The Rust parser handles this, but the regex intentionally does not.
    expect(extractPaths("file = {dir/a{b}.pdf}")).toEqual(["dir/a{b"]);
  });

  it("matches uppercase FILE field (case-insensitive)", () => {
    expect(extractPaths("FILE = {assets/doc.pdf}")).toEqual(["assets/doc.pdf"]);
  });

  it("matches mixed-case File field (case-insensitive)", () => {
    expect(extractPaths("File = {assets/doc.pdf}")).toEqual(["assets/doc.pdf"]);
  });
});

describe("path resolution for bib file links", () => {
  it("resolves relative path from bib file directory", () => {
    const pagePath = "refs/library.bib";
    const matchedPath = "papers/foo.pdf";
    const dir = getFileDir(pagePath)!;
    expect(dir).toBe("refs");
    expect(resolveRelativePath(dir, matchedPath)).toBe("refs/papers/foo.pdf");
  });

  it("resolves when bib is at root level", () => {
    const pagePath = "library.bib";
    const dir = getFileDir(pagePath)!;
    expect(dir).toBe("");
    expect(resolveRelativePath(dir, "assets/foo.pdf")).toBe("assets/foo.pdf");
  });

  it("resolves parent traversal", () => {
    const pagePath = "assets/bib/refs.bib";
    const dir = getFileDir(pagePath)!;
    expect(dir).toBe("assets/bib");
    expect(resolveRelativePath(dir, "../pdf/doc.pdf")).toBe("assets/pdf/doc.pdf");
  });

  it("passes absolute Unix path through without relative resolution", () => {
    const filePath = "/Users/x/papers/foo.pdf";
    const pagePath = "refs/library.bib";
    const dir = getFileDir(pagePath)!;
    const resolved =
      dir != null && !isAbsolutePath(filePath)
        ? resolveRelativePath(dir, filePath)
        : filePath;
    expect(resolved).toBe("/Users/x/papers/foo.pdf");
  });

  it("passes tilde path through without relative resolution", () => {
    const filePath = "~/Documents/foo.pdf";
    const pagePath = "refs/library.bib";
    const dir = getFileDir(pagePath)!;
    const resolved =
      dir != null && !isAbsolutePath(filePath)
        ? resolveRelativePath(dir, filePath)
        : filePath;
    expect(resolved).toBe("~/Documents/foo.pdf");
  });

  it("passes Windows drive path through without relative resolution", () => {
    const filePath = "C:\\Users\\x\\foo.pdf";
    const pagePath = "refs/library.bib";
    const dir = getFileDir(pagePath)!;
    const resolved =
      dir != null && !isAbsolutePath(filePath)
        ? resolveRelativePath(dir, filePath)
        : filePath;
    expect(resolved).toBe("C:\\Users\\x\\foo.pdf");
  });
});

describe("bibFileLinkExtension", () => {
  it("accepts a single pagePath argument and installs the facet", () => {
    const ext = bibFileLinkExtension("refs/library.bib");
    const state = EditorState.create({ doc: "", extensions: ext });
    expect(state.facet(bibPagePathFacet)).toBe("refs/library.bib");
  });
});


function makeViewWithBibExt(doc: string, pagePath: string): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [bibFileLinkExtension(pagePath)],
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  return new EditorView({ state, parent: container });
}

describe("click handler — decoration hit-testing", () => {
  it("cmd+click on file path calls selectPage with resolved path", () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({
      selectPage,
      pages: [{ relative_path: "refs/papers/foo.pdf", title: "foo", frontmatter: {}, created_at: null, modified_at: null, file_type: "pdf" as const }],
    });

    const doc = "  file = {papers/foo.pdf},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    // The decoration should cover "papers/foo.pdf" (positions 10-24)
    const pluginInst = view.plugin(bibFileLinkPlugin);
    expect(pluginInst).not.toBeNull();

    // Verify decoration exists at expected range
    let decoFrom: number | undefined;
    let decoTo: number | undefined;
    pluginInst!.decorations.between(0, doc.length, (from, to) => {
      decoFrom = from;
      decoTo = to;
    });
    expect(decoFrom).toBeDefined();
    expect(decoTo).toBeDefined();
    expect(view.state.doc.sliceString(decoFrom!, decoTo!)).toBe(
      "papers/foo.pdf",
    );

    // Simulate cmd+click at a position within the path
    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(selectPage).toHaveBeenCalledWith("refs/papers/foo.pdf");
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click outside file path does not call selectPage", () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({ selectPage });

    const doc = "  file = {papers/foo.pdf},\n  title = {Hello},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    // Click on "title" line — position 35 is within "title = {Hello}"
    vi.spyOn(view, "posAtCoords").mockReturnValue(35);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(selectPage).not.toHaveBeenCalled();
    view.dom.remove();
    view.destroy();
  });

  it("plain click (no modifier) does not navigate", () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({ selectPage });

    const doc = "  file = {papers/foo.pdf},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    vi.spyOn(view, "posAtCoords").mockReturnValue(15);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true }),
    );

    expect(selectPage).not.toHaveBeenCalled();
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click at pathEnd (closing delimiter) does not navigate", () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({ selectPage });

    const doc = "  file = {papers/foo.pdf},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoTo: number | undefined;
    pluginInst.decorations.between(0, doc.length, (_from, to) => {
      decoTo = to;
    });
    expect(decoTo).toBeDefined();

    // Position at decoTo is the closing brace '}' — not underlined, should not navigate
    vi.spyOn(view, "posAtCoords").mockReturnValue(decoTo!);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(selectPage).not.toHaveBeenCalled();
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click at pathEnd - 1 (last char of path) does navigate", () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({
      selectPage,
      pages: [{ relative_path: "refs/papers/foo.pdf", title: "foo", frontmatter: {}, created_at: null, modified_at: null, file_type: "pdf" as const }],
    });

    const doc = "  file = {papers/foo.pdf},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoTo: number | undefined;
    pluginInst.decorations.between(0, doc.length, (_from, to) => {
      decoTo = to;
    });
    expect(decoTo).toBeDefined();

    // Position at decoTo - 1 is the last char of the path — should navigate
    vi.spyOn(view, "posAtCoords").mockReturnValue(decoTo! - 1);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(selectPage).toHaveBeenCalledWith("refs/papers/foo.pdf");
    view.dom.remove();
    view.destroy();
  });

  it("handles quote-delimited file field", () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({
      selectPage,
      pages: [{ relative_path: "refs/assets/doc.pdf", title: "doc", frontmatter: {}, created_at: null, modified_at: null, file_type: "pdf" as const }],
    });

    const doc = '  file = "assets/doc.pdf",';
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 2);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(selectPage).toHaveBeenCalledWith("refs/assets/doc.pdf");
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click on absolute file path passes through without mangling", () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({ selectPage, pages: [] });

    const doc = "  file = {/Users/x/papers/foo.pdf},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(selectPage).toHaveBeenCalledWith("/Users/x/papers/foo.pdf");
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click on missing relative file shows error toast and does not navigate", () => {
    const selectPage = vi.fn();
    const show = vi.fn();
    useWorkspaceStore.setState({ selectPage, pages: [] });
    (useStatusMessageStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ show });

    const doc = "  file = {papers/foo.pdf},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(selectPage).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith("File not found: papers/foo.pdf", "error");
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click on tilde path shows error toast and does not navigate", () => {
    const selectPage = vi.fn();
    const show = vi.fn();
    useWorkspaceStore.setState({ selectPage, pages: [] });
    (useStatusMessageStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ show });

    const doc = "  file = {~/Documents/foo.pdf},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(selectPage).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith("Cannot open path: ~/Documents/foo.pdf", "error");
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click on Windows drive path shows error toast and does not navigate", () => {
    const selectPage = vi.fn();
    const show = vi.fn();
    useWorkspaceStore.setState({ selectPage, pages: [] });
    (useStatusMessageStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ show });

    const doc = "  file = {C:\\Users\\x\\foo.pdf},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(selectPage).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith("Cannot open path: C:\\Users\\x\\foo.pdf", "error");
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click on UNC path shows error toast and does not navigate", () => {
    const selectPage = vi.fn();
    const show = vi.fn();
    useWorkspaceStore.setState({ selectPage, pages: [] });
    (useStatusMessageStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ show });

    const doc = "  file = {\\\\server\\share\\x.pdf},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(selectPage).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith("Cannot open path: \\\\server\\share\\x.pdf", "error");
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click on unindexed extension shows 'Cannot open file type' toast, not 'File not found'", () => {
    const selectPage = vi.fn();
    const show = vi.fn();
    // Even though the path might exist on disk, .png is not indexed by scan_pages
    useWorkspaceStore.setState({ selectPage, pages: [] });
    (useStatusMessageStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ show });

    const doc = "  file = {assets/figure.png},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(selectPage).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith("Cannot open file type: .png", "error");
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click on file with no extension shows 'Cannot open file type' toast", () => {
    const selectPage = vi.fn();
    const show = vi.fn();
    useWorkspaceStore.setState({ selectPage, pages: [] });
    (useStatusMessageStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ show });

    const doc = "  file = {Makefile},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 2);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(selectPage).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith("Cannot open file type: (no extension)", "error");
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click on absolute path bypasses existence check even with empty pages", () => {
    const selectPage = vi.fn();
    const show = vi.fn();
    useWorkspaceStore.setState({ selectPage, pages: [] });
    (useStatusMessageStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ show });

    const doc = "  file = {/Users/x/papers/foo.pdf},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(selectPage).toHaveBeenCalledWith("/Users/x/papers/foo.pdf");
    expect(show).not.toHaveBeenCalled();
    view.dom.remove();
    view.destroy();
  });
});

describe("decoration offset — substring regression", () => {
  it('decorates the value, not the field name, in file = {file}', () => {
    const doc = "  file = {file},";
    const view = makeViewWithBibExt(doc, "some/page.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    let decoTo: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from, to) => {
      decoFrom = from;
      decoTo = to;
    });
    expect(decoFrom).toBeDefined();
    expect(decoTo).toBeDefined();
    // The decorated text must be the value "file" inside braces, not the field name
    expect(view.state.doc.sliceString(decoFrom!, decoTo!)).toBe("file");
    // The value starts after the opening brace at index 10 in the doc
    expect(decoFrom!).toBe(10);
    view.dom.remove();
    view.destroy();
  });

  it('decorates "f" inside braces in file = {f}', () => {
    const doc = "  file = {f},";
    const view = makeViewWithBibExt(doc, "some/page.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    let decoTo: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from, to) => {
      decoFrom = from;
      decoTo = to;
    });
    expect(decoFrom).toBeDefined();
    expect(decoTo).toBeDefined();
    expect(view.state.doc.sliceString(decoFrom!, decoTo!)).toBe("f");
    expect(decoFrom!).toBe(10);
    view.dom.remove();
    view.destroy();
  });

  it('decorates "e" inside braces in file = {e}', () => {
    const doc = "  file = {e},";
    const view = makeViewWithBibExt(doc, "some/page.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    let decoTo: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from, to) => {
      decoFrom = from;
      decoTo = to;
    });
    expect(decoFrom).toBeDefined();
    expect(decoTo).toBeDefined();
    expect(view.state.doc.sliceString(decoFrom!, decoTo!)).toBe("e");
    expect(decoFrom!).toBe(10);
    view.dom.remove();
    view.destroy();
  });

  it('decorates the full path in file = {my/file/report.pdf}', () => {
    const doc = "  file = {my/file/report.pdf},";
    const view = makeViewWithBibExt(doc, "some/page.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    let decoTo: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from, to) => {
      decoFrom = from;
      decoTo = to;
    });
    expect(decoFrom).toBeDefined();
    expect(decoTo).toBeDefined();
    expect(view.state.doc.sliceString(decoFrom!, decoTo!)).toBe("my/file/report.pdf");
    expect(decoFrom!).toBe(10);
    view.dom.remove();
    view.destroy();
  });

  it('decorates "file.pdf" correctly in file = {file.pdf} (sanity check)', () => {
    const doc = "  file = {file.pdf},";
    const view = makeViewWithBibExt(doc, "some/page.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    let decoTo: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from, to) => {
      decoFrom = from;
      decoTo = to;
    });
    expect(decoFrom).toBeDefined();
    expect(decoTo).toBeDefined();
    expect(view.state.doc.sliceString(decoFrom!, decoTo!)).toBe("file.pdf");
    expect(decoFrom!).toBe(10);
    view.dom.remove();
    view.destroy();
  });
});

// --- URL/DOI field tests ---

function extractUrlFields(text: string): { field: string; value: string }[] {
  BIB_FIELD_RE.lastIndex = 0;
  const results: { field: string; value: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = BIB_FIELD_RE.exec(text)) !== null) {
    const field = m[1]!;
    if (field.toLowerCase() !== "file") {
      results.push({ field, value: (m[2] ?? m[3])! });
    }
  }
  return results;
}

describe("BIB_FIELD_RE — url/doi fields", () => {
  it("matches url = {https://example.com}", () => {
    expect(extractUrlFields("url = {https://example.com}")).toEqual([
      { field: "url", value: "https://example.com" },
    ]);
  });

  it('matches url = "https://example.com"', () => {
    expect(extractUrlFields('url = "https://example.com"')).toEqual([
      { field: "url", value: "https://example.com" },
    ]);
  });

  it("matches doi = {10.1000/xyz123}", () => {
    expect(extractUrlFields("doi = {10.1000/xyz123}")).toEqual([
      { field: "doi", value: "10.1000/xyz123" },
    ]);
  });

  it('matches doi = "10.1000/xyz123"', () => {
    expect(extractUrlFields('doi = "10.1000/xyz123"')).toEqual([
      { field: "doi", value: "10.1000/xyz123" },
    ]);
  });

  it("matches with no spaces around =", () => {
    expect(extractUrlFields("url={https://example.com}")).toEqual([
      { field: "url", value: "https://example.com" },
    ]);
  });

  it("matches with extra spaces around =", () => {
    expect(extractUrlFields("url  =  {https://example.com}")).toEqual([
      { field: "url", value: "https://example.com" },
    ]);
  });

  it("matches url preceded by comma and whitespace", () => {
    expect(extractUrlFields("  url = {https://example.com}")).toEqual([
      { field: "url", value: "https://example.com" },
    ]);
  });

  it("does not match other fields", () => {
    expect(extractUrlFields("file = {foo.pdf}")).toEqual([]);
    expect(extractUrlFields("title = {Some Title}")).toEqual([]);
  });

  it("does not match field names ending in 'url'", () => {
    expect(extractUrlFields("someurl = {https://example.com}")).toEqual([]);
    expect(extractUrlFields("pdfurl = {https://example.com}")).toEqual([]);
  });

  it("matches multiple url/doi fields in one block", () => {
    const text = [
      "  url = {https://example.com},",
      "  title = {Hello},",
      "  doi = {10.1000/xyz123},",
    ].join("\n");
    expect(extractUrlFields(text)).toEqual([
      { field: "url", value: "https://example.com" },
      { field: "doi", value: "10.1000/xyz123" },
    ]);
  });

  it("matches uppercase URL field (case-insensitive)", () => {
    expect(extractUrlFields("URL = {https://example.com}")).toEqual([
      { field: "URL", value: "https://example.com" },
    ]);
  });

  it("matches uppercase DOI field (case-insensitive)", () => {
    expect(extractUrlFields("DOI = {10.1000/xyz123}")).toEqual([
      { field: "DOI", value: "10.1000/xyz123" },
    ]);
  });

  it("matches mixed-case Url and Doi fields (case-insensitive)", () => {
    expect(extractUrlFields("Url = {https://example.com}")).toEqual([
      { field: "Url", value: "https://example.com" },
    ]);
    expect(extractUrlFields("Doi = {10.1000/xyz123}")).toEqual([
      { field: "Doi", value: "10.1000/xyz123" },
    ]);
  });
});


describe("URL/DOI decoration", () => {
  it("decorates url field value with cm-bib-url-link", () => {
    const doc = "  url = {https://example.com},";
    const view = makeViewWithBibExt(doc, "some/page.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    let decoTo: number | undefined;
    let decoClass: string | undefined;
    pluginInst.decorations.between(0, doc.length, (from, to, value) => {
      decoFrom = from;
      decoTo = to;
      decoClass = value.spec.class;
    });
    expect(decoFrom).toBeDefined();
    expect(view.state.doc.sliceString(decoFrom!, decoTo!)).toBe("https://example.com");
    expect(decoClass).toBe("cm-bib-url-link");
    view.dom.remove();
    view.destroy();
  });

  it("decorates doi field value with cm-bib-url-link", () => {
    const doc = "  doi = {10.1000/xyz123},";
    const view = makeViewWithBibExt(doc, "some/page.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    let decoTo: number | undefined;
    let decoClass: string | undefined;
    let kind: string | undefined;
    pluginInst.decorations.between(0, doc.length, (from, to, value) => {
      decoFrom = from;
      decoTo = to;
      decoClass = value.spec.class;
      kind = value.spec.kind;
    });
    expect(decoFrom).toBeDefined();
    expect(view.state.doc.sliceString(decoFrom!, decoTo!)).toBe("10.1000/xyz123");
    expect(decoClass).toBe("cm-bib-url-link");
    expect(kind).toBe("doi");
    view.dom.remove();
    view.destroy();
  });

  it("mixed file+url document gets both decoration types", () => {
    const doc = "  file = {papers/foo.pdf},\n  url = {https://example.com},";
    const view = makeViewWithBibExt(doc, "some/page.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    const decos: { text: string; class: string }[] = [];
    pluginInst.decorations.between(0, doc.length, (from, to, value) => {
      decos.push({
        text: view.state.doc.sliceString(from, to),
        class: value.spec.class,
      });
    });
    expect(decos).toEqual([
      { text: "papers/foo.pdf", class: "cm-bib-file-link" },
      { text: "https://example.com", class: "cm-bib-url-link" },
    ]);
    view.dom.remove();
    view.destroy();
  });

  it("mixed url+file (reversed order) still produces sorted decorations", () => {
    const doc = "  url = {https://example.com},\n  file = {papers/foo.pdf},";
    const view = makeViewWithBibExt(doc, "some/page.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    const decos: { text: string; kind: string }[] = [];
    pluginInst.decorations.between(0, doc.length, (from, to, value) => {
      decos.push({
        text: view.state.doc.sliceString(from, to),
        kind: value.spec.kind,
      });
    });
    expect(decos).toEqual([
      { text: "https://example.com", kind: "url" },
      { text: "papers/foo.pdf", kind: "file" },
    ]);
    view.dom.remove();
    view.destroy();
  });

  it("all three field types on separate lines produce sorted decorations", () => {
    const doc = "  doi = {10.1000/xyz},\n  file = {foo.pdf},\n  url = {https://x.com},";
    const view = makeViewWithBibExt(doc, "some/page.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    const decos: { text: string; kind: string }[] = [];
    pluginInst.decorations.between(0, doc.length, (from, to, value) => {
      decos.push({
        text: view.state.doc.sliceString(from, to),
        kind: value.spec.kind,
      });
    });
    expect(decos).toEqual([
      { text: "10.1000/xyz", kind: "doi" },
      { text: "foo.pdf", kind: "file" },
      { text: "https://x.com", kind: "url" },
    ]);
    view.dom.remove();
    view.destroy();
  });
});

describe("decoration spec.kind discriminator", () => {
  it("file decoration has kind 'file'", () => {
    const doc = "  file = {papers/foo.pdf},";
    const view = makeViewWithBibExt(doc, "some/page.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let kind: string | undefined;
    pluginInst.decorations.between(0, doc.length, (_from, _to, value) => {
      kind = value.spec.kind;
    });
    expect(kind).toBe("file");
    view.dom.remove();
    view.destroy();
  });

  it("url decoration has kind 'url'", () => {
    const doc = "  url = {https://example.com},";
    const view = makeViewWithBibExt(doc, "some/page.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let kind: string | undefined;
    pluginInst.decorations.between(0, doc.length, (_from, _to, value) => {
      kind = value.spec.kind;
    });
    expect(kind).toBe("url");
    view.dom.remove();
    view.destroy();
  });

  it("doi decoration has kind 'doi'", () => {
    const doc = "  doi = {10.1000/xyz123},";
    const view = makeViewWithBibExt(doc, "some/page.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let kind: string | undefined;
    pluginInst.decorations.between(0, doc.length, (_from, _to, value) => {
      kind = value.spec.kind;
    });
    expect(kind).toBe("doi");
    view.dom.remove();
    view.destroy();
  });
});

describe("click handler — URL/DOI fields", () => {
  beforeEach(() => {
    vi.mocked(openUrl).mockClear();
  });

  it("cmd+click on url value calls openUrl", () => {
    const doc = "  url = {https://example.com},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(openUrl).toHaveBeenCalledWith("https://example.com");
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click on doi value calls openUrl with https://doi.org/ prefix", () => {
    const doc = "  doi = {10.1000/xyz123},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(openUrl).toHaveBeenCalledWith("https://doi.org/10.1000/xyz123");
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click on doi with full URL passes through without double-prefixing", () => {
    const doc = "  doi = {https://doi.org/10.1000/xyz123},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(openUrl).toHaveBeenCalledWith("https://doi.org/10.1000/xyz123");
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click on malformed url shows error toast", () => {
    const show = vi.fn();
    (useStatusMessageStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ show });

    const doc = "  url = {not a valid url},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(openUrl).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith("Invalid URL: not a valid url", "error");
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click shows error toast when openUrl rejects", async () => {
    const show = vi.fn();
    (useStatusMessageStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ show });
    vi.mocked(openUrl).mockRejectedValueOnce(new Error("no default browser"));

    const doc = "  url = {https://example.com},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    // Wait for the rejected promise's .catch handler to fire
    await vi.waitFor(() => {
      expect(show).toHaveBeenCalledWith("Failed to open URL", "error");
    });

    view.dom.remove();
    view.destroy();
  });

  it("cmd+click shows error toast when openUrl rejects for DOI", async () => {
    const show = vi.fn();
    (useStatusMessageStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ show });
    vi.mocked(openUrl).mockRejectedValueOnce(new Error("OS error"));

    const doc = "  doi = {10.1000/xyz123},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    await vi.waitFor(() => {
      expect(show).toHaveBeenCalledWith("Failed to open URL", "error");
    });

    view.dom.remove();
    view.destroy();
  });

  it("cmd+click on url does not call selectPage", () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({ selectPage, pages: [] });

    const doc = "  url = {https://example.com},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let decoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from) => {
      decoFrom = from;
    });
    expect(decoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(decoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(selectPage).not.toHaveBeenCalled();
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click on file value still calls selectPage (regression)", () => {
    const selectPage = vi.fn();
    useWorkspaceStore.setState({
      selectPage,
      pages: [{ relative_path: "refs/papers/foo.pdf", title: "foo", frontmatter: {}, created_at: null, modified_at: null, file_type: "pdf" as const }],
    });

    const doc = "  file = {papers/foo.pdf},\n  url = {https://example.com},";
    const view = makeViewWithBibExt(doc, "refs/library.bib");

    const pluginInst = view.plugin(bibFileLinkPlugin)!;
    let fileDecoFrom: number | undefined;
    pluginInst.decorations.between(0, doc.length, (from, _to, value) => {
      if (value.spec.kind === "file") {
        fileDecoFrom = from;
      }
    });
    expect(fileDecoFrom).toBeDefined();

    vi.spyOn(view, "posAtCoords").mockReturnValue(fileDecoFrom! + 3);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(selectPage).toHaveBeenCalledWith("refs/papers/foo.pdf");
    expect(openUrl).not.toHaveBeenCalled();
    view.dom.remove();
    view.destroy();
  });
});
