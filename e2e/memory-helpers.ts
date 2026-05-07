import type { Page, CDPSession } from "@playwright/test";

export async function createCDPSession(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

export async function forceGC(cdp: CDPSession): Promise<void> {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
}

export async function measureHeap(cdp: CDPSession): Promise<number> {
  await forceGC(cdp);
  await new Promise((r) => setTimeout(r, 100));
  const { metrics } = await cdp.send("Performance.getMetrics");
  const heap = metrics.find((m: { name: string }) => m.name === "JSHeapUsedSize");
  return heap?.value ?? 0;
}

export async function getWebGLStats(
  page: Page,
): Promise<{ created: number; lost: number; active: number }> {
  return page.evaluate(() => (window as any).__WEBGL_TRACKER__);
}
