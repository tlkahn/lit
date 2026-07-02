const THRESHOLD_MS = 16;

let enabled = false;
try {
  enabled = globalThis.localStorage?.getItem("lit-perf") === "1";
} catch {
  /* SSR / test — localStorage unavailable */
}

export function setPerfEnabled(v: boolean) {
  enabled = v;
}

export function isPerfEnabled() {
  return enabled;
}

export function perfMark(name: string) {
  if (enabled) performance.mark(name);
}

export function perfMeasure(name: string, startMark: string) {
  if (!enabled) return undefined;
  let m: PerformanceMeasure;
  try {
    m = performance.measure(name, startMark);
  } catch {
    // start mark absent — perf was enabled after the mark point was passed
    return undefined;
  }
  if (m.duration > THRESHOLD_MS) {
    console.warn(`[perf] ${name}: ${m.duration.toFixed(1)}ms (>${THRESHOLD_MS}ms target)`);
  }
  return m;
}

export interface PerfEntry {
  label: string;
  value: number;
  unit?: string;
  detail?: string;
}

const perfData = new Map<string, PerfEntry[]>();

export function perfTable(groupLabel: string, entries: PerfEntry[]) {
  if (!enabled) return;
  perfData.set(groupLabel, entries);
  console.table(
    Object.fromEntries(
      entries.map((e) => {
        const col = e.unit ?? "ms";
        return [e.label, { [col]: +e.value.toFixed(2), ...(e.detail != null ? { detail: e.detail } : {}) }];
      }),
    ),
  );
}

export function getPerfData(): ReadonlyMap<string, PerfEntry[]> {
  return perfData;
}
