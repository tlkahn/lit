import type { Clock } from "../../../src/types.js";

export function createClockFake(initial = 1700000000): Clock & {
  now: number;
  advance(seconds: number): void;
  reset(epoch?: number): void;
} {
  const fake = {
    now: initial,

    advance(seconds: number) {
      fake.now += seconds;
    },

    reset(epoch = 1700000000) {
      fake.now = epoch;
    },

    nowEpochSeconds(): number {
      return fake.now;
    },

    isOlderThan(ts: number, maxAgeSecs: number): boolean {
      return fake.now - ts > maxAgeSecs;
    },
  };

  return fake;
}
