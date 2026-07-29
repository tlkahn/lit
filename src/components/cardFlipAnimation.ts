/**
 * Two-phase card flip driver (Web Animations API).
 *
 * WebKit does not render the classic preserve-3d / backface-visibility flip
 * correctly in the cardbox masonry context (the hidden face bleeds through
 * mirrored). Instead we rotate the single stage element edge-on (0 -> 90deg),
 * swap the face content at the midpoint, then rotate back in (-90deg -> 0).
 * Perspective lives inside the keyframe transforms, so no ancestor CSS is
 * needed.
 *
 * Under prefers-reduced-motion the rotation is replaced by an opacity
 * cross-fade (same two-phase structure) — motion is removed, but the swap
 * still reads as a transition rather than a snap.
 */

export const FLIP_PHASE_MS = 200;
export const FADE_PHASE_MS = 120;

function phaseKeyframes(fromDeg: number, toDeg: number): Keyframe[] {
  return [
    { transform: `perspective(1000px) rotateY(${fromDeg}deg)` },
    { transform: `perspective(1000px) rotateY(${toDeg}deg)` },
  ];
}

export const FLIP_OUT_KEYFRAMES: Keyframe[] = phaseKeyframes(0, 90);
export const FLIP_OUT_TIMING: KeyframeAnimationOptions = {
  duration: FLIP_PHASE_MS,
  easing: "ease-in",
  fill: "forwards",
};

export const FLIP_IN_KEYFRAMES: Keyframe[] = phaseKeyframes(-90, 0);
export const FLIP_IN_TIMING: KeyframeAnimationOptions = {
  duration: FLIP_PHASE_MS,
  easing: "ease-out",
  fill: "forwards",
};

export const FADE_OUT_KEYFRAMES: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];
export const FADE_OUT_TIMING: KeyframeAnimationOptions = {
  duration: FADE_PHASE_MS,
  easing: "ease-in",
  fill: "forwards",
};

export const FADE_IN_KEYFRAMES: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
export const FADE_IN_TIMING: KeyframeAnimationOptions = {
  duration: FADE_PHASE_MS,
  easing: "ease-out",
  fill: "forwards",
};

export function prefersReducedMotion(): boolean {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

/** WAAPI available (jsdom lacks it — those environments swap instantly). */
export function canAnimateFlip(el: HTMLElement): boolean {
  return typeof el.animate === "function";
}

/**
 * Animate `stage` out, call `onMidpoint` (swap content there), animate back
 * in. Rotation normally; opacity cross-fade under prefers-reduced-motion.
 * Resolves when both phases finish. Cancellation (e.g. unmount) is swallowed;
 * `onMidpoint` is not called unless the out phase completed.
 */
export async function runFlipAnimation(
  stage: HTMLElement,
  onMidpoint: () => void,
): Promise<void> {
  const reduced = prefersReducedMotion();
  const outKeyframes = reduced ? FADE_OUT_KEYFRAMES : FLIP_OUT_KEYFRAMES;
  const outTiming = reduced ? FADE_OUT_TIMING : FLIP_OUT_TIMING;
  const inKeyframes = reduced ? FADE_IN_KEYFRAMES : FLIP_IN_KEYFRAMES;
  const inTiming = reduced ? FADE_IN_TIMING : FLIP_IN_TIMING;
  try {
    await stage.animate(outKeyframes, outTiming).finished;
  } catch {
    return;
  }
  onMidpoint();
  try {
    await stage.animate(inKeyframes, inTiming).finished;
  } catch {
    /* canceled mid-flight; end state is already correct */
  }
}
