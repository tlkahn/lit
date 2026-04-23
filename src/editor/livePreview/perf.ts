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
  const m = performance.measure(name, startMark);
  if (m.duration > THRESHOLD_MS) {
    console.warn(`[perf] ${name}: ${m.duration.toFixed(1)}ms (>${THRESHOLD_MS}ms target)`);
  }
  return m;
}
