import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setPerfEnabled, perfTable, getPerfData, type PerfEntry } from "./perf";

describe("perfTable", () => {
  beforeEach(() => {
    setPerfEnabled(true);
  });

  afterEach(() => {
    setPerfEnabled(false);
  });

  it("stores entries with value and unit fields", () => {
    const entries: PerfEntry[] = [
      { label: "Build", value: 12.345 },
      { label: "FPS", value: 60, unit: "fps" },
    ];

    const spy = vi.spyOn(console, "table").mockImplementation(() => {});
    perfTable("test-group", entries);

    const data = getPerfData();
    const stored = data.get("test-group")!;
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ label: "Build", value: 12.345 });
    expect(stored[1]).toMatchObject({ label: "FPS", value: 60, unit: "fps" });

    spy.mockRestore();
  });

  it("uses unit as column key in console.table output", () => {
    const entries: PerfEntry[] = [
      { label: "Render", value: 8.1 },
      { label: "Steady FPS", value: 59.5, unit: "fps" },
      { label: "Heap", value: 128, unit: "MB", detail: "v8" },
    ];

    const spy = vi.spyOn(console, "table").mockImplementation(() => {});
    perfTable("mixed-units", entries);

    const tableArg = spy.mock.calls[0]![0] as Record<string, Record<string, unknown>>;
    expect(tableArg["Render"]).toEqual({ ms: 8.1 });
    expect(tableArg["Steady FPS"]).toEqual({ fps: 59.5 });
    expect(tableArg["Heap"]).toEqual({ MB: 128, detail: "v8" });

    spy.mockRestore();
  });
});
