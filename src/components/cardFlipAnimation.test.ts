import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FLIP_PHASE_MS,
  FLIP_OUT_KEYFRAMES,
  FLIP_OUT_TIMING,
  FLIP_IN_KEYFRAMES,
  FLIP_IN_TIMING,
  canAnimateFlip,
  runFlipAnimation,
} from "./cardFlipAnimation";

interface Deferred {
  resolve: () => void;
  reject: (err: unknown) => void;
  promise: Promise<unknown>;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
}

function fakeStage(finishedList: Deferred[]) {
  let call = 0;
  const animate = vi.fn(() => {
    const d = finishedList[call];
    call += 1;
    return { finished: d!.promise } as unknown as Animation;
  });
  return { stage: { animate } as unknown as HTMLElement, animate };
}

describe("flip keyframes and timing", () => {
  it("out phase rotates from 0 to 90deg with perspective, ease-in", () => {
    expect(FLIP_OUT_KEYFRAMES).toEqual([
      { transform: "perspective(1000px) rotateY(0deg)" },
      { transform: "perspective(1000px) rotateY(90deg)" },
    ]);
    expect(FLIP_OUT_TIMING).toEqual({ duration: FLIP_PHASE_MS, easing: "ease-in", fill: "forwards" });
  });

  it("in phase rotates from -90deg back to 0, ease-out", () => {
    expect(FLIP_IN_KEYFRAMES).toEqual([
      { transform: "perspective(1000px) rotateY(-90deg)" },
      { transform: "perspective(1000px) rotateY(0deg)" },
    ]);
    expect(FLIP_IN_TIMING).toEqual({ duration: FLIP_PHASE_MS, easing: "ease-out", fill: "forwards" });
  });

  it("two phases total 400ms, matching the old 0.4s transition", () => {
    expect(FLIP_PHASE_MS * 2).toBe(400);
  });
});

describe("runFlipAnimation", () => {
  it("plays out phase, calls onMidpoint, then plays in phase, then resolves", async () => {
    const out = deferred();
    const inn = deferred();
    const { stage, animate } = fakeStage([out, inn]);
    const log: string[] = [];
    const onMidpoint = vi.fn(() => log.push("midpoint"));
    animate.mockImplementation(function (this: unknown, ...args: unknown[]) {
      const keyframes = args[0];
      log.push(keyframes === FLIP_OUT_KEYFRAMES ? "animate-out" : "animate-in");
      const d = keyframes === FLIP_OUT_KEYFRAMES ? out : inn;
      return { finished: d.promise } as unknown as Animation;
    });

    let settled = false;
    const done = runFlipAnimation(stage, onMidpoint).then(() => {
      settled = true;
    });

    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith(FLIP_OUT_KEYFRAMES, FLIP_OUT_TIMING);
    expect(onMidpoint).not.toHaveBeenCalled();

    out.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onMidpoint).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate).toHaveBeenLastCalledWith(FLIP_IN_KEYFRAMES, FLIP_IN_TIMING);
    expect(log).toEqual(["animate-out", "midpoint", "animate-in"]);
    expect(settled).toBe(false);

    inn.resolve();
    await done;
    expect(settled).toBe(true);
  });

  it("skips onMidpoint and resolves quietly when the out phase is canceled", async () => {
    const out = deferred();
    const { stage, animate } = fakeStage([out]);
    const onMidpoint = vi.fn();

    const done = runFlipAnimation(stage, onMidpoint);
    out.reject(new DOMException("aborted", "AbortError"));

    await expect(done).resolves.toBeUndefined();
    expect(onMidpoint).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("resolves quietly when the in phase is canceled after the midpoint", async () => {
    const out = deferred();
    const inn = deferred();
    const { stage } = fakeStage([out, inn]);
    const onMidpoint = vi.fn();

    const done = runFlipAnimation(stage, onMidpoint);
    out.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(onMidpoint).toHaveBeenCalledTimes(1);

    inn.reject(new DOMException("aborted", "AbortError"));
    await expect(done).resolves.toBeUndefined();
  });
});

describe("canAnimateFlip", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function el(withAnimate: boolean): HTMLElement {
    const div = document.createElement("div");
    if (withAnimate) {
      (div as unknown as { animate: unknown }).animate = vi.fn();
    } else {
      Object.defineProperty(div, "animate", { value: undefined });
    }
    return div;
  }

  it("is false when the element has no animate (jsdom)", () => {
    expect(canAnimateFlip(el(false))).toBe(false);
  });

  it("is false when prefers-reduced-motion is reduce", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    expect(canAnimateFlip(el(true))).toBe(false);
  });

  it("is true with WAAPI and no reduced-motion preference", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    expect(canAnimateFlip(el(true))).toBe(true);
  });

  it("is true with WAAPI when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(canAnimateFlip(el(true))).toBe(true);
  });
});
