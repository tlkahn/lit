/**
 * Two-phase card flip driver (Web Animations API).
 *
 * WebKit does not render the classic preserve-3d / backface-visibility flip
 * correctly in the cardbox masonry context (the hidden face bleeds through
 * mirrored). Instead we rotate the single stage element edge-on (0 -> 90deg),
 * swap the face content at the midpoint, then rotate back in (-90deg -> 0).
 * Perspective lives inside the keyframe transforms, so no ancestor CSS is
 * needed.
 */

export const FLIP_PHASE_MS = 200;

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

/** WAAPI available and the user has not requested reduced motion. */
export function canAnimateFlip(el: HTMLElement): boolean {
  if (typeof el.animate !== "function") return false;
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

/**
 * Rotate `stage` edge-on, call `onMidpoint` (swap content there), rotate back.
 * Resolves when both phases finish. Cancellation (e.g. unmount) is swallowed;
 * `onMidpoint` is not called unless the out phase completed.
 */
export async function runFlipAnimation(
  stage: HTMLElement,
  onMidpoint: () => void,
): Promise<void> {
  try {
    await stage.animate(FLIP_OUT_KEYFRAMES, FLIP_OUT_TIMING).finished;
  } catch {
    return;
  }
  onMidpoint();
  try {
    await stage.animate(FLIP_IN_KEYFRAMES, FLIP_IN_TIMING).finished;
  } catch {
    /* canceled mid-flight; end state is already correct */
  }
}
