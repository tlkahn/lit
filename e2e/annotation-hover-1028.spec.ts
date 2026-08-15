import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  EXPECTED_SCOPE,
  buildTauriIpcStubSource,
} from "./annotation-hover-1028-fixture";

const HARNESS_URL = "/e2e/annotation-hover-1028-harness.html";

// Minimal Tauri IPC stub covering the commands the editor invokes. Built from
// the shared fixture (single DOC / annotation source), so it cannot drift from
// the harness. resolve mimics the real Rust resolve_annotation_scope for this
// doc (sentence-1 backward resolution) with simulated IPC latency.
async function setup(page: Page) {
  await page.addInitScript(buildTauriIpcStubSource({ resolveDelayMs: 60 }));
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => window.__HOVER__?.ready === true, null, {
    timeout: 60_000,
  });
  // The two pills are rendered once annotation data lands.
  await page.waitForFunction(() => window.__HOVER__.state().pillCount === 2, null, {
    timeout: 5_000,
  });
}

/** Waits until the highlighted DOM text is exactly the expected scope text. */
function expectHighlighted(page: Page, text: string) {
  return page.waitForFunction(
    (expected) => {
      const s = window.__HOVER__.state();
      return (
        s.highlight != null && s.domHighlights.length === 1 && s.domHighlights[0] === expected
      );
    },
    text,
    { timeout: 5_000 },
  );
}

test("hover 2nd block annotation highlights its scope (issue 1028)", async ({ page }) => {
  await setup(page);

  const s0 = await page.evaluate(() => window.__HOVER__.state());
  expect(s0.pillCount).toBe(2);

  const pills = page.locator(".cm-annotation-pill");
  await pills.nth(0).hover();
  await expectHighlighted(page, EXPECTED_SCOPE.ann1);

  await pills.nth(1).hover();
  await expectHighlighted(page, EXPECTED_SCOPE.ann2);
});

test("widget rebuild while pointer is over the hovered pill keeps the highlight", async ({ page }) => {
  await setup(page);

  const pills = page.locator(".cm-annotation-pill");
  await pills.nth(1).hover();
  await expectHighlighted(page, EXPECTED_SCOPE.ann2);

  // Enrichment-style rebuild (uuid added -> eq() false -> DOM replaced).
  await page.evaluate(() => window.__HOVER__.enrich());
  await expectHighlighted(page, EXPECTED_SCOPE.ann2);
});

test("same-value rebuild while hovering keeps the highlight (eq() true)", async ({ page }) => {
  await setup(page);

  const pills = page.locator(".cm-annotation-pill");
  await pills.nth(1).hover();
  await expectHighlighted(page, EXPECTED_SCOPE.ann2);

  await page.evaluate(() => window.__HOVER__.rebuild());
  await expectHighlighted(page, EXPECTED_SCOPE.ann2);
});

test("fast pill1 -> pill2 move without pause ends on pill2's highlight", async ({ page }) => {
  await setup(page);

  const pills = page.locator(".cm-annotation-pill");
  // Continuous motion: enter pill1 then immediately slide to pill2 without
  // waiting for pill1's resolve to land (resolve is delayed 60ms in the stub).
  const b1 = await pills.nth(0).boundingBox();
  const b2 = await pills.nth(1).boundingBox();
  if (!b1 || !b2) throw new Error("pills missing");
  await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2, { steps: 12 });

  await expectHighlighted(page, EXPECTED_SCOPE.ann2);
});

test("hover pill2 while a rebuild is in-flight keeps highlight", async ({ page }) => {
  await setup(page);

  const pills = page.locator(".cm-annotation-pill");
  await pills.nth(1).hover();
  // Rebuild immediately: the first resolve (60ms stub delay) is still in
  // flight, so the widget replacement must not strand the pointer state.
  await page.evaluate(() => window.__HOVER__.enrich());
  await expectHighlighted(page, EXPECTED_SCOPE.ann2);
});
