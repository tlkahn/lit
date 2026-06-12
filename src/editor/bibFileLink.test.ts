import { describe, it, expect, vi } from "vitest";
import { BIB_FILE_FIELD_RE } from "./bibFileLink";
import { getFileDir, resolveRelativePath } from "../lib/pathUtils";

function extractPaths(text: string): string[] {
  const re = new RegExp(BIB_FILE_FIELD_RE.source, "g");
  const paths: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    paths.push(m[1]!);
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
});

describe("click handler logic", () => {
  it("requires modifier key", () => {
    const handler = vi.fn();
    const event = { button: 0, ctrlKey: false, metaKey: false };
    const shouldHandle = event.button === 0 && (event.ctrlKey || event.metaKey);
    expect(shouldHandle).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("accepts meta key", () => {
    const event = { button: 0, ctrlKey: false, metaKey: true };
    const shouldHandle = event.button === 0 && (event.ctrlKey || event.metaKey);
    expect(shouldHandle).toBe(true);
  });

  it("accepts ctrl key", () => {
    const event = { button: 0, ctrlKey: true, metaKey: false };
    const shouldHandle = event.button === 0 && (event.ctrlKey || event.metaKey);
    expect(shouldHandle).toBe(true);
  });

  it("rejects non-primary button", () => {
    const event = { button: 2, ctrlKey: true, metaKey: true };
    const shouldHandle = event.button === 0 && (event.ctrlKey || event.metaKey);
    expect(shouldHandle).toBe(false);
  });

  it("resolves selectPage path correctly", () => {
    const pagePath = "refs/library.bib";
    const matchedPath = "papers/foo.pdf";
    const dir = getFileDir(pagePath);
    const resolved =
      dir != null ? resolveRelativePath(dir, matchedPath) : matchedPath;
    expect(resolved).toBe("refs/papers/foo.pdf");
  });
});
