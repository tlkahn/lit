import { describe, it, expect } from "vitest";
import { getFileType, INDEXED_EXTENSIONS } from "./useLeafFileType";
import type { PageMeta } from "../lib/ipc";

function meta(
  relative_path: string,
  file_type: "markdown" | "pdf" | "code",
): PageMeta {
  return {
    title: relative_path,
    relative_path,
    frontmatter: {},
    created_at: null,
    modified_at: null,
    file_type,
  };
}

describe("getFileType", () => {
  it("returns 'pdf' for a pdf page", () => {
    expect(getFileType("doc.pdf", [meta("doc.pdf", "pdf")])).toBe("pdf");
  });

  it("returns 'markdown' for a markdown page", () => {
    expect(getFileType("note.md", [meta("note.md", "markdown")])).toBe("markdown");
  });

  it("returns null when pagePath is null", () => {
    expect(getFileType(null, [meta("note.md", "markdown")])).toBe(null);
  });

  it("falls back to 'pdf' by extension when the pages list has not loaded", () => {
    expect(getFileType("doc.pdf", [])).toBe("pdf");
    expect(getFileType("DOC.PDF", [])).toBe("pdf");
  });

  it("falls back to 'markdown' by extension for a non-pdf path with no matching page", () => {
    expect(getFileType("missing.md", [meta("note.md", "markdown")])).toBe("markdown");
    expect(getFileType("untitled", [])).toBe("markdown");
  });

  it("returns 'code' for a known code page", () => {
    expect(getFileType("refs.bib", [meta("refs.bib", "code")])).toBe("code");
  });

  it("falls back to 'code' by extension when the pages list is empty", () => {
    for (const path of [
      "refs.bib",
      "main.rs",
      "app.tsx",
      "conf.yaml",
      "data.json",
      "x.mjs",
      "y.cjs",
      "z.mts",
      "w.cts",
      "q.bash",
      "r.zsh",
      "s.htm",
    ]) {
      expect(getFileType(path, [])).toBe("code");
    }
  });

  it("does NOT treat .txt as code", () => {
    expect(getFileType("notes.txt", [])).toBe("markdown");
  });

  it("does NOT treat .md as code", () => {
    expect(getFileType("note.md", [])).toBe("markdown");
  });

  it("does NOT sniff an uppercase .RS extension as code (case-sensitive)", () => {
    expect(getFileType("main.RS", [])).toBe("markdown");
  });
});

describe("INDEXED_EXTENSIONS", () => {
  it("contains md, pdf, and bib", () => {
    expect(INDEXED_EXTENSIONS.has("md")).toBe(true);
    expect(INDEXED_EXTENSIONS.has("pdf")).toBe(true);
    expect(INDEXED_EXTENSIONS.has("bib")).toBe(true);
  });

  it("does NOT contain image or text extensions", () => {
    expect(INDEXED_EXTENSIONS.has("png")).toBe(false);
    expect(INDEXED_EXTENSIONS.has("jpg")).toBe(false);
    expect(INDEXED_EXTENSIONS.has("jpeg")).toBe(false);
    expect(INDEXED_EXTENSIONS.has("gif")).toBe(false);
    expect(INDEXED_EXTENSIONS.has("svg")).toBe(false);
    expect(INDEXED_EXTENSIONS.has("txt")).toBe(false);
  });
});
