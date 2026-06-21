import { describe, it, expect } from "vitest";
import {
  makePageComparator,
  toggleDirection,
  defaultDirectionFor,
} from "./pageSort";
import type { PageMeta } from "./ipc";

function page(title: string, overrides?: Partial<PageMeta>): PageMeta {
  return {
    title,
    relative_path: `${title}.md`,
    frontmatter: {},
    created_at: null,
    modified_at: null,
    file_type: "markdown",
    has_companion: false,
    ...overrides,
  };
}

describe("makePageComparator", () => {
  it("title asc sorts A before Z", () => {
    const cmp = makePageComparator({ key: "title", direction: "asc" });
    const pages = [page("Zebra"), page("Apple")];
    pages.sort(cmp);
    expect(pages.map((p) => p.title)).toEqual(["Apple", "Zebra"]);
  });

  it("title desc sorts Z before A", () => {
    const cmp = makePageComparator({ key: "title", direction: "desc" });
    const pages = [page("Apple"), page("Zebra")];
    pages.sort(cmp);
    expect(pages.map((p) => p.title)).toEqual(["Zebra", "Apple"]);
  });

  it("title sort is case-insensitive", () => {
    const cmp = makePageComparator({ key: "title", direction: "asc" });
    const pages = [page("banana"), page("Apple")];
    pages.sort(cmp);
    expect(pages.map((p) => p.title)).toEqual(["Apple", "banana"]);
  });

  it("modified_at desc sorts newest first", () => {
    const cmp = makePageComparator({ key: "modified_at", direction: "desc" });
    const pages = [
      page("Old", { modified_at: 1000 }),
      page("New", { modified_at: 2000 }),
    ];
    pages.sort(cmp);
    expect(pages.map((p) => p.title)).toEqual(["New", "Old"]);
  });

  it("modified_at asc sorts oldest first", () => {
    const cmp = makePageComparator({ key: "modified_at", direction: "asc" });
    const pages = [
      page("New", { modified_at: 2000 }),
      page("Old", { modified_at: 1000 }),
    ];
    pages.sort(cmp);
    expect(pages.map((p) => p.title)).toEqual(["Old", "New"]);
  });

  it("created_at desc sorts newest first", () => {
    const cmp = makePageComparator({ key: "created_at", direction: "desc" });
    const pages = [
      page("Old", { created_at: 1000 }),
      page("New", { created_at: 2000 }),
    ];
    pages.sort(cmp);
    expect(pages.map((p) => p.title)).toEqual(["New", "Old"]);
  });

  it("null timestamps sort after non-null regardless of direction", () => {
    const descCmp = makePageComparator({ key: "modified_at", direction: "desc" });
    const pagesDesc = [
      page("NoTime", { modified_at: null }),
      page("HasTime", { modified_at: 1000 }),
    ];
    pagesDesc.sort(descCmp);
    expect(pagesDesc.map((p) => p.title)).toEqual(["HasTime", "NoTime"]);

    const ascCmp = makePageComparator({ key: "modified_at", direction: "asc" });
    const pagesAsc = [
      page("NoTime", { modified_at: null }),
      page("HasTime", { modified_at: 1000 }),
    ];
    pagesAsc.sort(ascCmp);
    expect(pagesAsc.map((p) => p.title)).toEqual(["HasTime", "NoTime"]);
  });

  it("equal timestamps fall back to title asc", () => {
    const cmp = makePageComparator({ key: "modified_at", direction: "desc" });
    const pages = [
      page("Banana", { modified_at: 1000 }),
      page("Apple", { modified_at: 1000 }),
    ];
    pages.sort(cmp);
    expect(pages.map((p) => p.title)).toEqual(["Apple", "Banana"]);
  });
});

describe("toggleDirection", () => {
  it('toggles asc to desc and desc to asc', () => {
    expect(toggleDirection("asc")).toBe("desc");
    expect(toggleDirection("desc")).toBe("asc");
  });
});

describe("defaultDirectionFor", () => {
  it('title defaults to asc', () => {
    expect(defaultDirectionFor("title")).toBe("asc");
  });

  it('modified_at defaults to desc', () => {
    expect(defaultDirectionFor("modified_at")).toBe("desc");
  });

  it('created_at defaults to desc', () => {
    expect(defaultDirectionFor("created_at")).toBe("desc");
  });
});
