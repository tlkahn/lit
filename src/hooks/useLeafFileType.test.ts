import { describe, it, expect } from "vitest";
import { getFileType } from "./useLeafFileType";
import type { PageMeta } from "../lib/ipc";

function meta(relative_path: string, file_type: "markdown" | "pdf"): PageMeta {
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
});
