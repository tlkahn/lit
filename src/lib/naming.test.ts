import { describe, it, expect } from "vitest";
import { getNextUntitledName } from "./naming";
import type { PageMeta } from "./ipc";

function makePage(title: string, path?: string): PageMeta {
  return {
    title,
    relative_path: path ?? `${title}.md`,
    frontmatter: {},
    created_at: 1000,
    modified_at: 2000,
    file_type: 'markdown',
  };
}

describe("getNextUntitledName", () => {
  it("returns 'Untitled' when pages are empty", () => {
    expect(getNextUntitledName([])).toBe("Untitled");
  });

  it("returns 'Untitled' when no conflict exists", () => {
    expect(getNextUntitledName([makePage("My Page")])).toBe("Untitled");
  });

  it("returns 'Untitled 1' when 'Untitled' exists", () => {
    expect(getNextUntitledName([makePage("Untitled")])).toBe("Untitled 1");
  });

  it("returns 'Untitled 2' when both 'Untitled' and 'Untitled 1' exist", () => {
    const pages = [makePage("Untitled"), makePage("Untitled 1")];
    expect(getNextUntitledName(pages)).toBe("Untitled 2");
  });

  it("fills gaps — skips to first available number", () => {
    const pages = [
      makePage("Untitled"),
      makePage("Untitled 1"),
      makePage("Untitled 3"),
    ];
    expect(getNextUntitledName(pages)).toBe("Untitled 2");
  });

  it("detects conflicts across subdirectories (matches on title, not path)", () => {
    const pages = [makePage("Untitled", "notes/Untitled.md")];
    expect(getNextUntitledName(pages)).toBe("Untitled 1");
  });

  it("is case-sensitive — 'untitled' does not conflict with 'Untitled'", () => {
    expect(getNextUntitledName([makePage("untitled")])).toBe("Untitled");
  });
});
