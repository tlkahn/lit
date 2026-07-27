import { test, expect } from "@playwright/test";
import { ipcStubScript } from "./ipc-stub";
import { createCDPSession } from "./memory-helpers";

const HARNESS_URL = "/e2e/annotation-perf-harness.html";
const SMOKE_CAP_MS = 10_000;
const RUNS = 3;

type OpName = "foldAll" | "expandAll" | "foldSingle" | "typeBurst";

interface TimingResult {
  syncMs: number;
  paintMs: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

interface PerfMetrics {
  LayoutCount: number;
  RecalcStyleCount: number;
}

async function readPerfMetrics(
  cdp: Awaited<ReturnType<typeof createCDPSession>>,
): Promise<PerfMetrics> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const byName = new Map(
    (metrics as { name: string; value: number }[]).map((m) => [m.name, m.value]),
  );
  return {
    LayoutCount: byName.get("LayoutCount") ?? 0,
    RecalcStyleCount: byName.get("RecalcStyleCount") ?? 0,
  };
}

test.beforeEach(async ({ page }) => {
  // parseAnnotations fails closed via the stub; harness seeds annotations itself.
  await page.addInitScript(ipcStubScript);
});

test("annotation fold dispatch-to-paint timings", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => window.__PERF__?.ready === true, null, {
    timeout: 60_000,
  });

  const annotationCount = await page.evaluate(() => window.__PERF__.annotationCount);
  console.log(`[annotation-perf] annotationCount=${annotationCount}`);
  expect(annotationCount).toBeGreaterThanOrEqual(150);

  const cdp = await createCDPSession(page);
  await cdp.send("Performance.enable");

  async function measure(label: OpName): Promise<{
    medianSyncMs: number;
    medianPaintMs: number;
    syncSamples: number[];
    paintSamples: number[];
    layoutDelta: number;
    recalcDelta: number;
  }> {
    const syncSamples: number[] = [];
    const paintSamples: number[] = [];
    let layoutDelta = 0;
    let recalcDelta = 0;

    for (let i = 0; i < RUNS; i++) {
      const before = await readPerfMetrics(cdp);
      const timing = await page.evaluate((name: OpName) => {
        const api = window.__PERF__;
        if (name === "foldAll") return api.foldAll();
        if (name === "expandAll") return api.expandAll();
        if (name === "foldSingle") return api.foldSingle();
        return api.typeBurst();
      }, label);
      const after = await readPerfMetrics(cdp);
      syncSamples.push(timing.syncMs);
      paintSamples.push(timing.paintMs);
      layoutDelta += after.LayoutCount - before.LayoutCount;
      recalcDelta += after.RecalcStyleCount - before.RecalcStyleCount;
    }

    layoutDelta = layoutDelta / RUNS;
    recalcDelta = recalcDelta / RUNS;
    const medianSyncMs = median(syncSamples);
    const medianPaintMs = median(paintSamples);

    console.log(
      `[annotation-perf] ${label}: sync=[${syncSamples.map((s) => s.toFixed(1)).join(", ")}] ` +
        `medianSync=${medianSyncMs.toFixed(1)}ms ` +
        `paint=[${paintSamples.map((s) => s.toFixed(1)).join(", ")}] ` +
        `medianPaint=${medianPaintMs.toFixed(1)}ms ` +
        `layoutΔ=${layoutDelta.toFixed(1)} recalcΔ=${recalcDelta.toFixed(1)}`,
    );

    expect(medianSyncMs).toBeGreaterThanOrEqual(0);
    expect(medianPaintMs).toBeLessThan(SMOKE_CAP_MS);
    return {
      medianSyncMs,
      medianPaintMs,
      syncSamples,
      paintSamples,
      layoutDelta,
      recalcDelta,
    };
  }

  const foldAll = await measure("foldAll");
  const expandAll = await measure("expandAll");
  const foldSingle = await measure("foldSingle");
  const typeBurst = await measure("typeBurst");

  // Stage 0: no hard performance gates beyond the smoke cap (asserted in measure).
  console.log(
    `[annotation-perf] SUMMARY ` +
      `foldAll sync=${foldAll.medianSyncMs.toFixed(1)}ms paint=${foldAll.medianPaintMs.toFixed(1)}ms | ` +
      `expandAll sync=${expandAll.medianSyncMs.toFixed(1)}ms paint=${expandAll.medianPaintMs.toFixed(1)}ms | ` +
      `foldSingle sync=${foldSingle.medianSyncMs.toFixed(1)}ms paint=${foldSingle.medianPaintMs.toFixed(1)}ms | ` +
      `typeBurst sync=${typeBurst.medianSyncMs.toFixed(1)}ms paint=${typeBurst.medianPaintMs.toFixed(1)}ms`,
  );
});

declare global {
  interface Window {
    __PERF__: {
      ready: boolean;
      annotationCount: number;
      foldAll(): Promise<TimingResult>;
      expandAll(): Promise<TimingResult>;
      foldSingle(): Promise<TimingResult>;
      typeBurst(): Promise<TimingResult>;
    };
  }
}
