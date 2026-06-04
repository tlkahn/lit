import { describe, it, expect, beforeEach } from "vitest";
import { buildMarkStylesCss, injectMarkStyles } from "./markStyles";
import type { MarkConfig } from "../../lib/ipc";

const STYLE_ID = "lit-mark-styles";

// Collapse all whitespace so substring assertions are formatting-agnostic.
function norm(css: string): string {
  return css.replace(/\s+/g, " ").trim();
}

describe("buildMarkStylesCss", () => {
  it("emits a .cm-mark-{code} block from the style table", () => {
    const config: MarkConfig = {
      nb: { label: "nota bene", style: { "font-weight": "bold" } },
    };
    const css = norm(buildMarkStylesCss(config));
    expect(css).toContain(".cm-mark-nb");
    expect(css).toContain("font-weight: bold");
  });

  it("emits ::before / ::after content rules", () => {
    const config: MarkConfig = {
      crux: { label: "crux", before: "†", after: "†", style: { opacity: "0.6" } },
    };
    const css = norm(buildMarkStylesCss(config));
    expect(css).toContain(".cm-mark-crux::before");
    expect(css).toContain(".cm-mark-crux::after");
    expect(css).toContain("content:");
    expect(css).toContain("†");
    // The plain decoration block carries the style props.
    expect(css).toMatch(/\.cm-mark-crux\s*\{[^}]*opacity/);
  });

  it("escapes content strings so they cannot break out of the value", () => {
    const config: MarkConfig = {
      q: { label: "quote", before: 'a"b' },
    };
    const css = buildMarkStylesCss(config);
    // The raw double-quote must be backslash-escaped inside the content value.
    expect(css).toContain('content: "a\\"b"');
    // No unescaped closing quote followed by the terminating quote.
    expect(css).not.toContain('content: "a"b"');
  });

  it("skips marks that have no style, before, or after", () => {
    const config: MarkConfig = {
      plain: { label: "plain" },
    };
    const css = buildMarkStylesCss(config);
    expect(css).not.toContain(".cm-mark-plain");
  });

  it("emits multiple style props in a single block", () => {
    const config: MarkConfig = {
      del: {
        label: "del",
        style: { "text-decoration": "line-through", opacity: "0.5" },
      },
    };
    const css = buildMarkStylesCss(config);
    const block = css.match(/\.cm-mark-del\s*\{([^}]*)\}/);
    expect(block).not.toBeNull();
    const body = norm(block?.[1] ?? "");
    expect(body).toContain("text-decoration: line-through");
    expect(body).toContain("opacity: 0.5");
  });

  it("escapes the mark code in selectors (style block)", () => {
    const config: MarkConfig = {
      "foo.bar": { label: "x", style: { color: "red" } },
    };
    const css = buildMarkStylesCss(config);
    // CSS.escape turns "foo.bar" into "foo\.bar" — assert against its output
    // rather than hand-writing backslashes.
    expect(css).toContain(`.cm-mark-${CSS.escape("foo.bar")}`);
    // The raw, unescaped selector (which would match an element with class
    // "cm-mark-foo" AND class "bar") must NOT appear.
    expect(css).not.toContain(".cm-mark-foo.bar {");
  });

  it("escapes the mark code in ::before / ::after selectors", () => {
    const config: MarkConfig = {
      "foo.bar": { label: "x", before: "[", after: "]" },
    };
    const css = buildMarkStylesCss(config);
    expect(css).toContain(`.cm-mark-${CSS.escape("foo.bar")}::before`);
    expect(css).toContain(`.cm-mark-${CSS.escape("foo.bar")}::after`);
    expect(css).not.toContain(".cm-mark-foo.bar::before");
    expect(css).not.toContain(".cm-mark-foo.bar::after");
  });

  it("drops style entries with a malformed property name", () => {
    const config: MarkConfig = {
      bad: {
        label: "bad",
        // A property name that tries to close the block and open a new one.
        style: { "color: red; } body { display": "none", opacity: "0.5" },
      },
    };
    const css = buildMarkStylesCss(config);
    // The injected "body" selector must not leak into the output.
    expect(css).not.toContain("body");
    // The legitimate sibling declaration still survives.
    expect(css).toContain("opacity: 0.5");
  });

  it("drops style entries with a malformed value", () => {
    const config: MarkConfig = {
      bad: {
        label: "bad",
        style: { color: "red; } body { display: none", "font-weight": "bold" },
      },
    };
    const css = buildMarkStylesCss(config);
    expect(css).not.toContain("} body {");
    expect(css).not.toContain("display: none");
    expect(css).toContain("font-weight: bold");
  });

  it("emits no empty block when every style entry is malformed", () => {
    const config: MarkConfig = {
      bad: {
        label: "bad",
        style: { "co lor": "red", opacity: "0.5; } body {" },
      },
    };
    const css = buildMarkStylesCss(config);
    expect(css).not.toContain(".cm-mark-bad");
    expect(css).not.toContain("body");
  });

  it("drops style entries with a trailing backslash in the value", () => {
    const config: MarkConfig = {
      bad: {
        label: "bad",
        style: { color: "red\\", "font-weight": "bold" },
      },
    };
    const css = buildMarkStylesCss(config);
    expect(css).not.toContain("color");
    expect(css).toContain("font-weight: bold");
  });

  it("drops style entries with a newline in the value", () => {
    const config: MarkConfig = {
      bad: {
        label: "bad",
        style: { color: "red\n} body { display: none", opacity: "0.5" },
      },
    };
    const css = buildMarkStylesCss(config);
    expect(css).not.toContain("body");
    expect(css).toContain("opacity: 0.5");
  });

  it("skips before/after when they contain a null byte", () => {
    const config: MarkConfig = {
      bad: {
        label: "bad",
        before: "a\x00b",
        after: "c\x00d",
        style: { opacity: "0.5" },
      },
    };
    const css = buildMarkStylesCss(config);
    expect(css).not.toContain("::before");
    expect(css).not.toContain("::after");
    expect(css).toContain("opacity: 0.5");
  });

  it("skips before with control char but still emits sibling style block", () => {
    const config: MarkConfig = {
      bad: {
        label: "bad",
        before: "a\x01b",
        style: { "font-weight": "bold" },
      },
    };
    const css = buildMarkStylesCss(config);
    expect(css).not.toContain("::before");
    expect(css).toContain("font-weight: bold");
  });

  it("allows unicode symbols in before/after", () => {
    const config: MarkConfig = {
      crux: { label: "crux", before: "†", after: "⸗" },
    };
    const css = buildMarkStylesCss(config);
    expect(css).toContain("†");
    expect(css).toContain("⸗");
    expect(css).toContain("::before");
    expect(css).toContain("::after");
  });

  it("preserves legitimate complex property/value pairs", () => {
    const config: MarkConfig = {
      ok: {
        label: "ok",
        style: {
          "font-weight": "bold",
          opacity: "0.6",
          border: "1px solid #ccc",
          color: "var(--x)",
          background: "rgb(0, 0, 0)",
        },
      },
    };
    const css = buildMarkStylesCss(config);
    expect(css).toContain("font-weight: bold");
    expect(css).toContain("opacity: 0.6");
    expect(css).toContain("border: 1px solid #ccc");
    expect(css).toContain("color: var(--x)");
    expect(css).toContain("background: rgb(0, 0, 0)");
  });
});

describe("injectMarkStyles", () => {
  beforeEach(() => {
    document.querySelectorAll(`#${STYLE_ID}`).forEach((el) => el.remove());
    document
      .querySelectorAll("style[data-test-dummy]")
      .forEach((el) => el.remove());
  });

  it("creates exactly one <style> whose textContent matches the generated CSS", () => {
    const config: MarkConfig = {
      nb: { label: "nb", style: { "font-weight": "bold" } },
    };
    injectMarkStyles(config);
    const els = document.querySelectorAll(`#${STYLE_ID}`);
    expect(els.length).toBe(1);
    expect(els[0]!.textContent).toBe(buildMarkStylesCss(config));
  });

  it("updates (does not duplicate) the style element on a second call", () => {
    injectMarkStyles({ nb: { label: "nb", style: { "font-weight": "bold" } } });
    const next: MarkConfig = {
      it: { label: "it", style: { "font-style": "italic" } },
    };
    injectMarkStyles(next);
    const els = document.querySelectorAll(`#${STYLE_ID}`);
    expect(els.length).toBe(1);
    expect(els[0]!.textContent).toBe(buildMarkStylesCss(next));
    expect(els[0]!.textContent).toContain(".cm-mark-it");
    expect(els[0]!.textContent).not.toContain(".cm-mark-nb");
  });

  it("appends the style element last so it overrides the static stylesheet", () => {
    const dummy = document.createElement("style");
    dummy.setAttribute("data-test-dummy", "true");
    document.head.appendChild(dummy);
    injectMarkStyles({ nb: { label: "nb", style: { "font-weight": "bold" } } });
    const styles = document.head.querySelectorAll("style");
    expect(styles[styles.length - 1]!.id).toBe(STYLE_ID);
  });
});
