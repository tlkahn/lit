import { describe, it, expect } from "vitest";
import {
  DEFAULT_ANNOTATION_LANG,
  normalizeLang,
  frontmatterLang,
  effectiveAnnotationLang,
} from "./annotationLang";

// This table is duplicated in `src-tauri/src/annotation/lang.rs`; the two
// implementations must agree or index-time and live-preview segmentation
// diverge, which is the bug this whole feature exists to prevent (#854).
describe("normalizeLang", () => {
  it("keeps a plain tag", () => {
    expect(normalizeLang("en")).toBe("en");
    expect(normalizeLang("fr")).toBe("fr");
    expect(normalizeLang("zh")).toBe("zh");
  });

  it("lowercases and trims", () => {
    expect(normalizeLang("  FR  ")).toBe("fr");
    expect(normalizeLang("En")).toBe("en");
  });

  it("drops region subtags", () => {
    expect(normalizeLang("zh-CN")).toBe("zh");
    expect(normalizeLang("en-US")).toBe("en");
    expect(normalizeLang("fr-CA")).toBe("fr");
    expect(normalizeLang("es-419")).toBe("es");
  });

  it("keeps script subtags", () => {
    expect(normalizeLang("zh-Hant")).toBe("zh-hant");
    expect(normalizeLang("zh-Hans")).toBe("zh-hans");
    expect(normalizeLang("zh-Hant-TW")).toBe("zh-hant");
  });

  it("accepts an underscore separator", () => {
    expect(normalizeLang("zh_CN")).toBe("zh");
  });

  it("drops variant subtags", () => {
    expect(normalizeLang("de-DE-1996")).toBe("de");
  });

  it("rejects empty, blank and malformed tags", () => {
    for (const raw of ["", "   ", "e", "123", "fr!", "english-language-tag", "-fr"]) {
      expect(normalizeLang(raw), raw).toBeNull();
    }
  });

  it("rejects nullish input", () => {
    expect(normalizeLang(null)).toBeNull();
    expect(normalizeLang(undefined)).toBeNull();
  });
});

describe("frontmatterLang", () => {
  it("reads the namespaced key", () => {
    expect(frontmatterLang({ "annotation-lang": "fr" })).toBe("fr");
  });

  it("falls back to pandoc's lang", () => {
    expect(frontmatterLang({ lang: "fr-CA" })).toBe("fr");
  });

  it("prefers the namespaced key", () => {
    expect(frontmatterLang({ "annotation-lang": "ja", lang: "fr-CA" })).toBe("ja");
  });

  it("falls through when the namespaced key is unusable", () => {
    expect(frontmatterLang({ "annotation-lang": "  ", lang: "fr" })).toBe("fr");
  });

  it("ignores missing, non-string and nullish frontmatter", () => {
    expect(frontmatterLang({})).toBeNull();
    expect(frontmatterLang({ lang: 42 })).toBeNull();
    expect(frontmatterLang({ lang: ["fr"] })).toBeNull();
    expect(frontmatterLang(null)).toBeNull();
    expect(frontmatterLang(undefined)).toBeNull();
  });
});

describe("effectiveAnnotationLang", () => {
  it("prefers the annotation scope", () => {
    expect(effectiveAnnotationLang("fr", { "annotation-lang": "ja" }, "zh")).toBe("fr");
  });

  it("falls back to the document scope", () => {
    expect(effectiveAnnotationLang(null, { "annotation-lang": "ja" }, "zh")).toBe("ja");
    expect(effectiveAnnotationLang(undefined, { lang: "ja" }, "zh")).toBe("ja");
  });

  it("falls back to the global scope", () => {
    expect(effectiveAnnotationLang(null, {}, "zh")).toBe("zh");
  });

  it("falls back to the default when nothing is set", () => {
    expect(effectiveAnnotationLang(null, {}, undefined)).toBe(DEFAULT_ANNOTATION_LANG);
    expect(DEFAULT_ANNOTATION_LANG).toBe("en");
  });

  it("normalizes the winner", () => {
    expect(effectiveAnnotationLang("FR-ca", {}, "en")).toBe("fr");
    expect(effectiveAnnotationLang(null, { lang: "zh-Hant-TW" }, "en")).toBe("zh-hant");
  });

  it("skips unusable values at each scope", () => {
    expect(effectiveAnnotationLang("  ", { lang: "ja" }, "zh")).toBe("ja");
    expect(effectiveAnnotationLang("!!", { lang: "" }, "zh")).toBe("zh");
    expect(effectiveAnnotationLang("!!", { lang: "" }, "?")).toBe("en");
  });
});
