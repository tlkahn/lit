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
