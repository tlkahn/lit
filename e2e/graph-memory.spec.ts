import { test, expect } from "@playwright/test";
import { ipcStubScript } from "./ipc-stub";
import { webglTrackerScript } from "./webgl-tracker";
import { createCDPSession, measureHeap, getWebGLStats } from "./memory-helpers";

const CYCLE_COUNT = 10;
const WARMUP_CYCLES = 2;
const HEAP_GROWTH_THRESHOLD_MB = 2;
const HARNESS_URL = "/e2e/harness.html";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(webglTrackerScript);
  await page.addInitScript(ipcStubScript);
});

async function mountAndWaitForCanvas(page: import("@playwright/test").Page) {
  await page.getByTestId("toggle-mount").click();
  await page.getByTestId("graph-canvas").waitFor({ state: "visible" });
  await page.locator('[data-testid="graph-canvas"] canvas').first().waitFor({ state: "attached", timeout: 10_000 });
  await page.waitForTimeout(500);
}

async function unmountGraph(page: import("@playwright/test").Page) {
  await page.getByTestId("toggle-mount").click();
  await page.waitForTimeout(300);
}

test.describe("GraphView memory & cleanup", () => {
  test("heap stable after mount/unmount cycles", async ({ page }) => {
    await page.goto(HARNESS_URL);
    await page.getByTestId("toggle-mount").waitFor();

    for (let i = 0; i < WARMUP_CYCLES; i++) {
      await mountAndWaitForCanvas(page);
      await unmountGraph(page);
    }

    const cdp = await createCDPSession(page);
    await cdp.send("Performance.enable");
    const baseline = await measureHeap(cdp);

    await page.evaluate(
      ([count]) => window.__HARNESS_CYCLE__(count, "mount"),
      [CYCLE_COUNT],
    );
    await page.getByTestId("status").filter({ hasText: "done" }).waitFor({ timeout: 30_000 });

    const final = await measureHeap(cdp);
    const growthMB = (final - baseline) / (1024 * 1024);

    expect(growthMB).toBeLessThan(HEAP_GROWTH_THRESHOLD_MB);
  });

  test("heap stable after mode-switch cycles", async ({ page }) => {
    await page.goto(HARNESS_URL);
    await page.getByTestId("toggle-mount").waitFor();
    await mountAndWaitForCanvas(page);

    for (let i = 0; i < WARMUP_CYCLES; i++) {
      await page.getByRole("button", { name: "Local" }).click();
      await page.waitForTimeout(600);
      await page.getByRole("button", { name: "Full" }).click();
      await page.waitForTimeout(600);
    }

    const cdp = await createCDPSession(page);
    await cdp.send("Performance.enable");
    const baseline = await measureHeap(cdp);

    await page.evaluate(
      ([count]) => window.__HARNESS_CYCLE__(count, "mode"),
      [CYCLE_COUNT],
    );
    await page.getByTestId("status").filter({ hasText: "done" }).waitFor({ timeout: 30_000 });

    const final = await measureHeap(cdp);
    const growthMB = (final - baseline) / (1024 * 1024);

    expect(growthMB).toBeLessThan(HEAP_GROWTH_THRESHOLD_MB);
  });

  test("WebGL contexts released on unmount", async ({ page }) => {
    await page.goto(HARNESS_URL);
    await page.getByTestId("toggle-mount").waitFor();
    await mountAndWaitForCanvas(page);

    const before = await getWebGLStats(page);
    expect(before.active).toBeGreaterThan(0);
    expect(before.created).toBeGreaterThan(0);

    await unmountGraph(page);

    const after = await getWebGLStats(page);
    expect(after.active).toBe(0);
    expect(after.lost).toBe(after.created);
  });

  test("WebGL context count stable across mode switches", async ({ page }) => {
    await page.goto(HARNESS_URL);
    await page.getByTestId("toggle-mount").waitFor();
    await mountAndWaitForCanvas(page);

    const initial = await getWebGLStats(page);
    const initialActive = initial.active;

    for (let i = 0; i < 5; i++) {
      await page.getByRole("button", { name: "Local" }).click();
      await page.waitForTimeout(600);
      await page.getByRole("button", { name: "Full" }).click();
      await page.waitForTimeout(600);
    }

    const final = await getWebGLStats(page);
    expect(final.active).toBe(initialActive);
    expect(final.lost).toBe(final.created - initialActive);
  });
});
