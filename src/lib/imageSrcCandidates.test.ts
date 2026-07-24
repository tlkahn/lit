import { describe, it, expect } from "vitest";
import {
  isNakedImagePath,
  resolveImageDirBase,
  imageSrcCandidates,
  asImageDirString,
  DEFAULT_IMAGE_DIR,
} from "./imageSrcCandidates";

describe("DEFAULT_IMAGE_DIR", () => {
  it("equals 'assets/images'", () => {
    expect(DEFAULT_IMAGE_DIR).toBe("assets/images");
  });
});

describe("isNakedImagePath", () => {
  it("returns true for bare filename", () => {
    expect(isNakedImagePath("img.png")).toBe(true);
  });

  it("returns true for subdir/filename", () => {
    expect(isNakedImagePath("stem/page_12.png")).toBe(true);
  });

  it("returns true for deeper relative path", () => {
    expect(isNakedImagePath("a/b/c.jpg")).toBe(true);
  });

  it("returns false for ./relative", () => {
    expect(isNakedImagePath("./img.png")).toBe(false);
  });

  it("returns false for ../relative", () => {
    expect(isNakedImagePath("../img.png")).toBe(false);
  });

  it("returns false for absolute /path", () => {
    expect(isNakedImagePath("/abs/img.png")).toBe(false);
  });

  it("returns false for ~/path", () => {
    expect(isNakedImagePath("~/img.png")).toBe(false);
  });

  it("returns false for https URL", () => {
    expect(isNakedImagePath("https://example.com/img.png")).toBe(false);
  });

  it("returns false for http URL", () => {
    expect(isNakedImagePath("http://example.com/img.png")).toBe(false);
  });

  it("returns false for data URI", () => {
    expect(isNakedImagePath("data:image/png;base64,abc")).toBe(false);
  });

  it("returns false for blob URI", () => {
    expect(isNakedImagePath("blob:http://localhost/abc")).toBe(false);
  });

  it("returns false for Windows drive path", () => {
    expect(isNakedImagePath("C:\\Users\\img.png")).toBe(false);
  });

  it("returns false for bare ~ (home)", () => {
    expect(isNakedImagePath("~")).toBe(false);
  });
});

describe("resolveImageDirBase", () => {
  it("returns absolute path as-is", () => {
    expect(resolveImageDirBase("/abs/images", "/note/dir", "/ws")).toBe("/abs/images");
  });

  it("resolves ./relative against noteDir", () => {
    expect(resolveImageDirBase("./imgs", "/ws/notes", "/ws")).toBe("/ws/notes/imgs");
  });

  it("resolves ../relative against noteDir", () => {
    expect(resolveImageDirBase("../imgs", "/ws/sub/notes", "/ws")).toBe("/ws/sub/imgs");
  });

  it("resolves bare name against workspacePath", () => {
    expect(resolveImageDirBase("assets/images", "/ws/notes", "/ws")).toBe("/ws/assets/images");
  });

  it("resolves single-segment bare name against workspacePath", () => {
    expect(resolveImageDirBase("attachments", "/ws/notes", "/ws")).toBe("/ws/attachments");
  });

  it("trims trailing slash", () => {
    expect(resolveImageDirBase("assets/images/", "/ws/notes", "/ws")).toBe("/ws/assets/images");
  });

  it("handles empty imageDir by returning workspacePath", () => {
    expect(resolveImageDirBase("", "/ws/notes", "/ws")).toBe("/ws");
  });

  it("returns Windows drive path as-is", () => {
    expect(resolveImageDirBase("C:/imgs", "/ws/notes", "/ws")).toBe("C:/imgs");
  });

  it("returns UNC path as-is", () => {
    expect(resolveImageDirBase("\\\\server\\share", "/ws/notes", "/ws")).toBe("\\\\server\\share");
  });
});

describe("asImageDirString", () => {
  it("returns the string for a non-empty string", () => {
    expect(asImageDirString("media")).toBe("media");
  });

  it("returns undefined for a number", () => {
    expect(asImageDirString(42)).toBeUndefined();
  });

  it("returns undefined for a boolean", () => {
    expect(asImageDirString(true)).toBeUndefined();
  });

  it("returns undefined for an object", () => {
    expect(asImageDirString({ path: "x" })).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(asImageDirString("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(asImageDirString("   ")).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(asImageDirString(undefined)).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(asImageDirString(null)).toBeUndefined();
  });

  it("returns trimmed string for padded input", () => {
    expect(asImageDirString("  media  ")).toBe("media");
  });
});

describe("imageSrcCandidates", () => {
  it("returns single candidate for URL src", () => {
    expect(
      imageSrcCandidates({ src: "https://example.com/img.png", noteDir: "/ws", workspacePath: "/ws", imageDir: "assets/images" }),
    ).toEqual(["https://example.com/img.png"]);
  });

  it("returns single candidate for data URI", () => {
    expect(
      imageSrcCandidates({ src: "data:image/png;base64,abc", noteDir: "/ws", workspacePath: "/ws", imageDir: "assets/images" }),
    ).toEqual(["data:image/png;base64,abc"]);
  });

  it("returns single candidate for ./relative src", () => {
    expect(
      imageSrcCandidates({ src: "./img.png", noteDir: "/ws/notes", workspacePath: "/ws", imageDir: "assets/images" }),
    ).toEqual(["/ws/notes/img.png"]);
  });

  it("returns single candidate for ../relative src", () => {
    expect(
      imageSrcCandidates({ src: "../img.png", noteDir: "/ws/sub/notes", workspacePath: "/ws", imageDir: "assets/images" }),
    ).toEqual(["/ws/sub/img.png"]);
  });

  it("returns two candidates for naked src (primary + fallback)", () => {
    expect(
      imageSrcCandidates({ src: "stem/img.png", noteDir: "/ws/notes", workspacePath: "/ws", imageDir: "assets/images" }),
    ).toEqual(["/ws/notes/stem/img.png", "/ws/assets/images/stem/img.png"]);
  });

  it("returns two candidates for bare filename", () => {
    expect(
      imageSrcCandidates({ src: "img.png", noteDir: "/ws/notes", workspacePath: "/ws", imageDir: "assets/images" }),
    ).toEqual(["/ws/notes/img.png", "/ws/assets/images/img.png"]);
  });

  it("deduplicates when primary equals fallback", () => {
    expect(
      imageSrcCandidates({ src: "img.png", noteDir: "/ws/assets/images", workspacePath: "/ws", imageDir: "assets/images" }),
    ).toEqual(["/ws/assets/images/img.png"]);
  });

  it("skips fallback when src already starts with imageDir", () => {
    expect(
      imageSrcCandidates({ src: "assets/images/stem/img.png", noteDir: "/ws", workspacePath: "/ws", imageDir: "assets/images" }),
    ).toEqual(["/ws/assets/images/stem/img.png"]);
  });

  it("returns single candidate when workspacePath is empty", () => {
    expect(
      imageSrcCandidates({ src: "stem/img.png", noteDir: "/ws/notes", workspacePath: "", imageDir: "assets/images" }),
    ).toEqual(["/ws/notes/stem/img.png"]);
  });

  it("returns single candidate when noteDir is empty", () => {
    expect(
      imageSrcCandidates({ src: "stem/img.png", noteDir: "", workspacePath: "/ws", imageDir: "assets/images" }),
    ).toEqual(["stem/img.png", "/ws/assets/images/stem/img.png"]);
  });

  it("uses per-file imageDir override (absolute)", () => {
    expect(
      imageSrcCandidates({ src: "stem/img.png", noteDir: "/ws/notes", workspacePath: "/ws", imageDir: "/custom/images" }),
    ).toEqual(["/ws/notes/stem/img.png", "/custom/images/stem/img.png"]);
  });

  it("uses per-file imageDir override (./relative)", () => {
    expect(
      imageSrcCandidates({ src: "stem/img.png", noteDir: "/ws/notes", workspacePath: "/ws", imageDir: "./local-imgs" }),
    ).toEqual(["/ws/notes/stem/img.png", "/ws/notes/local-imgs/stem/img.png"]);
  });
});
