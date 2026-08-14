import { describe, it, expect } from "vitest";
import { pagePathStem } from "./pagePathStem";

describe("pagePathStem", () => {
  it("strips directory and extension", () => {
    expect(pagePathStem("notes/deep/page-name.md")).toBe("page-name");
  });

  it("no extension returns base", () => {
    expect(pagePathStem("notes/README")).toBe("README");
  });

  it("single leading dot is kept (dotfile style)", () => {
    expect(pagePathStem("notes/.gitignore")).toBe(".gitignore");
  });

  it("last-dot rule: foo.bar.baz -> foo.bar", () => {
    expect(pagePathStem("foo.bar.baz")).toBe("foo.bar");
  });

  it("empty path stays empty", () => {
    expect(pagePathStem("")).toBe("");
  });
});
