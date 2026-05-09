export function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function isOlderThan(ts: number, maxAgeSecs: number): boolean {
  return nowEpochSeconds() - ts > maxAgeSecs;
}
