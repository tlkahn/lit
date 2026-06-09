import { describe, it, expect } from "vitest";
import { LanguageSupport } from "@codemirror/language";
import { resolveLanguage, loadLanguage } from "./codeLanguages";

describe("resolveLanguage", () => {
  it("resolves .bib to BibTeX", () => {
    expect(resolveLanguage("refs.bib")?.name).toBe("BibTeX");
  });

  it("resolves a nested path's .bib (basename handling)", () => {
    expect(resolveLanguage("a/b/refs.bib")?.name).toBe("BibTeX");
  });

  it("resolves common code extensions via language-data", () => {
    expect(resolveLanguage("main.ts")?.name).toBe("TypeScript");
    expect(resolveLanguage("app.py")?.name).toBe("Python");
    expect(resolveLanguage("lib.rs")?.name).toBe("Rust");
    expect(resolveLanguage("data.json")?.name).toBe("JSON");
  });

  it("returns null for an unknown extension", () => {
    expect(resolveLanguage("file.unknownext")).toBeNull();
  });
});

describe("loadLanguage", () => {
  it("loads a LanguageSupport for .bib", async () => {
    const support = await loadLanguage("refs.bib");
    expect(support).toBeInstanceOf(LanguageSupport);
  });

  it("returns null for an unknown extension", async () => {
    const support = await loadLanguage("file.unknownext");
    expect(support).toBeNull();
  });
});
