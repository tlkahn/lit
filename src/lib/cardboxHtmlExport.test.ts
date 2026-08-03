import { describe, it, expect } from "vitest";
import type { CardboxAnnotation } from "./ipc";
import { renderCardboxHtml } from "./cardboxHtmlExport";

function card(overrides: Partial<CardboxAnnotation> = {}): CardboxAnnotation {
  return {
    uuid: "test-uuid",
    annotation_type: "note",
    certainty: "medium",
    body: "Test body",
    date: "2026-08-03",
    source_page_id: "notes/a.md",
    source_page_title: "Test Page",
    source_line: 1,
    char_start: 0,
    char_end: 10,
    scope_kind: "word",
    scope_value: "test",
    original: "quoted text",
    ...overrides,
  };
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function styleText(doc: Document): string {
  const style = doc.querySelector("style");
  return style ? normalizeWhitespace(style.textContent ?? "") : "";
}

describe("renderCardboxHtml", () => {
  // B1: skeleton
  describe("B1: skeleton", () => {
    it("starts with <!DOCTYPE html>", () => {
      const html = renderCardboxHtml([], { title: "Test" });
      expect(html).toMatch(/^<!DOCTYPE html>/);
    });

    it("has lang=en", () => {
      const doc = parse(renderCardboxHtml([], { title: "Test" }));
      expect(doc.documentElement.lang).toBe("en");
    });

    it("has meta charset", () => {
      const doc = parse(renderCardboxHtml([], { title: "Test" }));
      expect(doc.querySelector("meta[charset]")).not.toBeNull();
    });

    it("has exactly one <style>", () => {
      const doc = parse(renderCardboxHtml([], { title: "Test" }));
      expect(doc.querySelectorAll("style").length).toBe(1);
    });

    it("has <main class='cards'>", () => {
      const doc = parse(renderCardboxHtml([], { title: "Test" }));
      expect(doc.querySelector("main.cards")).not.toBeNull();
    });
  });

  // B2: title escaping
  describe("B2: title escaping", () => {
    it("escapes XSS in title", () => {
      const html = renderCardboxHtml([], {
        title: 'Notes <script>alert(1)</script>',
      });
      const doc = parse(html);
      expect(doc.title).toBe('Notes <script>alert(1)</script>');
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script");
    });

    it("shows title in page header h1", () => {
      const doc = parse(renderCardboxHtml([], { title: "My Title" }));
      const h1 = doc.querySelector("header.page-header h1");
      expect(h1).not.toBeNull();
      expect(h1!.textContent).toBe("My Title");
    });
  });

  // B3: self-contained fence
  describe("B3: self-contained", () => {
    it("has no script, external link, or external img", () => {
      const doc = parse(
        renderCardboxHtml([card()], { title: "Test" }),
      );
      expect(
        doc.querySelectorAll("script, link[href], img[src^='http']").length,
      ).toBe(0);
    });
  });

  // B4: order preserved
  describe("B4: order preserved", () => {
    it("emits cards in array order", () => {
      const cards = [
        card({ body: "alpha", uuid: "u1" }),
        card({ body: "beta", uuid: "u2" }),
        card({ body: "gamma", uuid: "u3" }),
      ];
      const doc = parse(renderCardboxHtml(cards, { title: "T" }));
      const fronts = Array.from(
        doc.querySelectorAll(".face--front .face-scroll"),
      ).map((el) => el.textContent?.trim() ?? "");
      expect(fronts[0]).toContain("alpha");
      expect(fronts[1]).toContain("beta");
      expect(fronts[2]).toContain("gamma");
    });

    it("does not reorder internally", () => {
      const forward = [
        card({ body: "alpha", uuid: "u1" }),
        card({ body: "beta", uuid: "u2" }),
      ];
      const reversed = [
        card({ body: "beta", uuid: "u2" }),
        card({ body: "alpha", uuid: "u1" }),
      ];
      const htmlF = renderCardboxHtml(forward, { title: "T" });
      const htmlR = renderCardboxHtml(reversed, { title: "T" });
      const idxAlphaF = htmlF.indexOf("alpha");
      const idxBetaF = htmlF.indexOf("beta");
      const idxAlphaR = htmlR.indexOf("alpha");
      const idxBetaR = htmlR.indexOf("beta");
      expect(idxAlphaF).toBeLessThan(idxBetaF);
      expect(idxBetaR).toBeLessThan(idxAlphaR);
    });
  });

  // B5: front is rendered markdown
  describe("B5: front is rendered markdown", () => {
    it("renders markdown in front face", () => {
      const c = card({ body: "**bold** and `code`" });
      const doc = parse(renderCardboxHtml([c], { title: "T" }));
      const front = doc.querySelector(".face--front .face-scroll")!;
      expect(front.querySelector("strong")).not.toBeNull();
      expect(front.querySelector("code")).not.toBeNull();
      expect(front.innerHTML).not.toContain("**");
    });
  });

  // B6: flip structure
  describe("B6: flip structure", () => {
    it("has correct flip markup for card with original", () => {
      const c = card({ original: "quoted *text*" });
      const doc = parse(renderCardboxHtml([c], { title: "T" }));
      const section = doc.querySelector("section.card")!;
      expect(section.classList.contains("card--flippable")).toBe(true);

      const input = section.querySelector("input.flip-toggle")!;
      expect(input).not.toBeNull();
      expect(input.getAttribute("type")).toBe("checkbox");
      expect(input.hasAttribute("hidden")).toBe(true);

      const cardInner = section.querySelector(".card-inner")!;
      expect(input).toBe(cardInner.previousElementSibling);

      const backScroll = section.querySelector(
        ".face--back .face-scroll",
      )!;
      expect(backScroll.querySelector("em")).not.toBeNull();

      const labels = section.querySelectorAll("label.flip-btn");
      expect(labels.length).toBe(2);
      for (const label of labels) {
        expect(label.getAttribute("for")).toBe(input.id);
      }
    });
  });

  // B7: single-sided
  describe("B7: single-sided", () => {
    it("card with null original is single-sided", () => {
      const c = card({ original: null });
      const doc = parse(renderCardboxHtml([c], { title: "T" }));
      const section = doc.querySelector("section.card")!;
      expect(section.classList.contains("card--single")).toBe(true);
      expect(section.classList.contains("card--flippable")).toBe(false);
      expect(section.querySelector("input")).toBeNull();
      expect(section.querySelector("label")).toBeNull();
      expect(section.querySelector(".face--back")).toBeNull();
      expect(
        section.querySelector(".face--front .face-scroll"),
      ).not.toBeNull();
    });

    it("card with empty original is single-sided", () => {
      const c = card({ original: "" });
      const doc = parse(renderCardboxHtml([c], { title: "T" }));
      const section = doc.querySelector("section.card")!;
      expect(section.classList.contains("card--single")).toBe(true);
    });
  });

  // B8: id safety
  describe("B8: id safety", () => {
    it("uses index-based ids, not uuids", () => {
      const cards = [
        card({ uuid: 'has"quotes', original: "o1" }),
        card({ uuid: "has<angle>", original: "o2" }),
        card({ uuid: "normal", original: "o3" }),
      ];
      const doc = parse(renderCardboxHtml(cards, { title: "T" }));
      const inputs = doc.querySelectorAll("input.flip-toggle");
      const ids = Array.from(inputs).map((el) => el.id);
      expect(ids).toEqual(["c0", "c1", "c2"]);
      const html = renderCardboxHtml(cards, { title: "T" });
      expect(html).not.toContain('has"quotes');
      expect(html).not.toContain("has<angle>");
    });
  });

  // B9: null body
  describe("B9: null body", () => {
    it("handles null body gracefully", () => {
      const c = card({ body: null, original: "quoted" });
      expect(() => renderCardboxHtml([c], { title: "T" })).not.toThrow();
      const doc = parse(renderCardboxHtml([c], { title: "T" }));
      const front = doc.querySelector(".face--front .face-scroll")!;
      expect(front).not.toBeNull();
      const section = doc.querySelector("section.card")!;
      expect(section.classList.contains("card--flippable")).toBe(true);
    });
  });

  // B10: XSS fence
  describe("B10: XSS fence", () => {
    it("sanitizes XSS in body and original", () => {
      const c = card({
        body: '<img src=x onerror=alert(1)><script>bad()</script>',
        original: "<svg onload=alert(2)>",
      });
      const html = renderCardboxHtml([c], { title: "T" });
      expect(html).not.toContain("onerror");
      expect(html).not.toContain("onload");
      expect(html).not.toContain("<script");
    });
  });

  // B11: no chrome
  describe("B11: no chrome", () => {
    it("does not include type, certainty, or date in output", () => {
      const c = card({
        annotation_type: "claim",
        certainty: "high",
        date: "2026-08-03",
        body: "only body",
        original: "only original",
      });
      const html = renderCardboxHtml([c], { title: "T" });
      expect(html).not.toContain("claim");
      expect(html).not.toContain("high");
      expect(html).not.toContain("2026-08-03");
    });
  });

  // B12: flip + scroll CSS invariants
  describe("B12: flip + scroll CSS invariants", () => {
    it("style contains perspective", () => {
      expect(styleText(parse(renderCardboxHtml([card()], { title: "T" })))).toContain("perspective");
    });

    it("style contains transform-style: preserve-3d", () => {
      expect(styleText(parse(renderCardboxHtml([card()], { title: "T" })))).toContain("transform-style: preserve-3d");
    });

    it("style contains backface-visibility: hidden", () => {
      expect(styleText(parse(renderCardboxHtml([card()], { title: "T" })))).toContain("backface-visibility: hidden");
    });

    it("style contains rotateY(180deg)", () => {
      expect(styleText(parse(renderCardboxHtml([card()], { title: "T" })))).toContain("rotateY(180deg)");
    });

    it("style contains .flip-toggle:checked ~ .card-inner", () => {
      expect(styleText(parse(renderCardboxHtml([card()], { title: "T" })))).toContain(".flip-toggle:checked ~ .card-inner");
    });

    it("style contains overflow-y: auto", () => {
      expect(styleText(parse(renderCardboxHtml([card()], { title: "T" })))).toContain("overflow-y: auto");
    });

    it("style contains --card-h", () => {
      expect(styleText(parse(renderCardboxHtml([card()], { title: "T" })))).toContain("--card-h");
    });
  });

  // B13: conditional KaTeX CSS
  describe("B13: conditional KaTeX CSS", () => {
    it("includes katexCss when math is present", () => {
      const c = card({ body: "energy $E=mc^2$" });
      const html = renderCardboxHtml([c], {
        title: "T",
        katexCss: "/*KATEX-STUB*/",
      });
      expect(html).toContain("/*KATEX-STUB*/");
    });

    it("excludes katexCss when no math is present", () => {
      const c = card({ body: "no math here" });
      const html = renderCardboxHtml([c], {
        title: "T",
        katexCss: "/*KATEX-STUB*/",
      });
      expect(html).not.toContain("/*KATEX-STUB*/");
    });
  });
});
