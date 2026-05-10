interface WaitForOptions {
  timeout?: number;
  interval?: number;
}

export async function waitFor<T>(
  fn: () => Promise<T>,
  opts: WaitForOptions & { until: (result: T) => boolean },
): Promise<T> {
  const timeout = opts.timeout ?? 10_000;
  const interval = opts.interval ?? 1_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const result = await fn();
    if (opts.until(result)) return result;
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(`waitFor timed out after ${timeout}ms`);
}
