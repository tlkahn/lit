import { describe, it, expect } from "vitest";
import { resolveRelativePath, getFileDir, frontmatterLineCount, isAbsolutePath, isOpenablePath } from "./pathUtils";

describe("resolveRelativePath", () => {
  it("resolves simple relative path", () => {
    expect(resolveRelativePath("sub", "image.png")).toBe("sub/image.png");
  });

  it("resolves with empty base", () => {
    expect(resolveRelativePath("", "image.png")).toBe("image.png");
  });

  it("resolves .. segments", () => {
    expect(resolveRelativePath("a/b", "../c.png")).toBe("a/c.png");
  });

  it("resolves . segments", () => {
    expect(resolveRelativePath("a/b", "./c.png")).toBe("a/b/c.png");
  });

  it("resolves multiple .. segments", () => {
    expect(resolveRelativePath("a/b/c", "../../d.png")).toBe("a/d.png");
  });

  it("does not go above root", () => {
    expect(resolveRelativePath("a", "../../x.png")).toBe("x.png");
  });

  it("handles trailing slashes in base", () => {
    expect(resolveRelativePath("a/", "b.png")).toBe("a/b.png");
  });
});

describe("getFileDir", () => {
  it("returns directory for nested path", () => {
    expect(getFileDir("sub/hello.md")).toBe("sub");
  });

  it("returns empty string for root-level file", () => {
    expect(getFileDir("hello.md")).toBe("");
  });

  it("returns null for null input", () => {
    expect(getFileDir(null)).toBeNull();
  });

  it("handles deeply nested path", () => {
    expect(getFileDir("a/b/c/file.md")).toBe("a/b/c");
  });
});

describe("isAbsolutePath", () => {
  it("detects Unix absolute path", () => {
    expect(isAbsolutePath("/Users/x/foo.pdf")).toBe(true);
  });

  it("detects Unix root-level path", () => {
    expect(isAbsolutePath("/foo.pdf")).toBe(true);
  });

  it("detects tilde-expanded path", () => {
    expect(isAbsolutePath("~/Documents/foo.pdf")).toBe(true);
  });

  it("detects lone tilde", () => {
    expect(isAbsolutePath("~")).toBe(true);
  });

  it("detects Windows backslash drive path", () => {
    expect(isAbsolutePath("C:\\foo.pdf")).toBe(true);
  });

  it("detects Windows forward-slash drive path", () => {
    expect(isAbsolutePath("D:/bar/baz.pdf")).toBe(true);
  });

  it("rejects relative path", () => {
    expect(isAbsolutePath("papers/foo.pdf")).toBe(false);
  });

  it("rejects bare filename", () => {
    expect(isAbsolutePath("foo.pdf")).toBe(false);
  });

  it("rejects parent-relative path", () => {
    expect(isAbsolutePath("../foo.pdf")).toBe(false);
  });

  it("rejects dot-relative path", () => {
    expect(isAbsolutePath("./foo.pdf")).toBe(false);
  });

  it("detects UNC path", () => {
    expect(isAbsolutePath("\\\\server\\share\\x.pdf")).toBe(true);
  });

  it("rejects single backslash prefix", () => {
    expect(isAbsolutePath("\\foo")).toBe(false);
  });
});

describe("isOpenablePath", () => {
  it("accepts Unix absolute path", () => {
    expect(isOpenablePath("/Users/x/foo.pdf")).toBe(true);
  });

  it("rejects tilde path", () => {
    expect(isOpenablePath("~/Documents/foo.pdf")).toBe(false);
  });

  it("rejects Windows drive path", () => {
    expect(isOpenablePath("C:\\foo.pdf")).toBe(false);
  });

  it("rejects UNC path", () => {
    expect(isOpenablePath("\\\\server\\share\\x.pdf")).toBe(false);
  });

  it("rejects relative path", () => {
    expect(isOpenablePath("papers/foo.pdf")).toBe(false);
  });
});

describe("frontmatterLineCount", () => {
  it("returns 0 for empty string", () => {
    expect(frontmatterLineCount("")).toBe(0);
  });

  it("counts lines correctly for multi-line yaml", () => {
    expect(frontmatterLineCount("title: Hello\ntags: [a, b]")).toBe(4);
  });

  it("counts lines correctly for single-line yaml", () => {
    expect(frontmatterLineCount("title: Hello")).toBe(3);
  });

  it("handles trailing newline", () => {
    expect(frontmatterLineCount("title: Hello\n")).toBe(3);
  });
});
