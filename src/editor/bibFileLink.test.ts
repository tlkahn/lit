import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { BIB_FILE_FIELD_RE, bibFileLinkExtension, bibFileLinkPlugin, bibPagePathFacet } from "./bibFileLink";
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
  const re = new RegExp(BIB_FILE_FIELD_RE.source, "g");
  const paths: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    paths.push((m[1] ?? m[2])!);
  }
  return paths;
}

describe("BIB_FILE_FIELD_RE", () => {
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
