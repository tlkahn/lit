import { test, expect } from "@playwright/test";

// Regression test for the callout header phantom-height bug: the header
// widget used to be a block-level flex div, which split the line's inline
// content into three line boxes — CM6's widget buffers (IMG elements around
// every inline widget) each claimed a full line-height, adding two lines of
// phantom vertical space to the header. With the inline-flex header the line
// must be exactly one line box plus the block's edge padding.
test("callout header line is a single line box", async ({ page }) => {
  await page.goto("/e2e/callout-harness.html");
  await page.waitForSelector(".cm-callout-first");

  const lines = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".cm-line.cm-callout")).map((el) => {
      const cs = getComputedStyle(el);
      return {
        cls: el.className,
        height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(cs.lineHeight),
        paddingTop: parseFloat(cs.paddingTop),
        paddingBottom: parseFloat(cs.paddingBottom),
      };
    }),
  );
  expect(lines.length).toBeGreaterThan(0);

  for (const line of lines) {
    const expected = line.paddingTop + line.lineHeight + line.paddingBottom;
    expect(line.height, line.cls).toBeLessThanOrEqual(expected + 1);
  }

  const headers = lines.filter((l) => l.cls.includes("cm-callout-first"));
  expect(headers.length).toBe(3);
  for (const h of headers) {
    expect(h.paddingTop).toBe(8);
    expect(h.paddingBottom).toBe(6);
  }
});
