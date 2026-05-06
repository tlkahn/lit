export type PositionMap = Record<string, { x: number; y: number }>;

export interface ConvergenceState {
  consecutiveLow: number;
}

export interface ConvergenceOptions {
  threshold?: number;
  requiredSamples?: number;
}

export interface ConvergenceResult {
  converged: boolean;
  displacement: number;
  state: ConvergenceState;
}

export const DEFAULT_THRESHOLD = 0.5;
export const DEFAULT_REQUIRED_SAMPLES = 5;

export function getConvergenceOptions(order: number): ConvergenceOptions {
  const logFactor = 1 + Math.log(Math.max(order, 1));
  return {
    threshold: DEFAULT_THRESHOLD / Math.sqrt(logFactor),
    requiredSamples: order > 2000 ? 3 : DEFAULT_REQUIRED_SAMPLES,
  };
}

export function checkConvergence(
  prev: PositionMap,
  current: PositionMap,
  state: ConvergenceState,
  options?: ConvergenceOptions,
): ConvergenceResult {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const requiredSamples = options?.requiredSamples ?? DEFAULT_REQUIRED_SAMPLES;

  const prevKeys = Object.keys(prev);
  const currentKeys = new Set(Object.keys(current));
  const intersection = prevKeys.filter((k) => currentKeys.has(k));

  if (intersection.length === 0) {
    return { converged: true, displacement: 0, state: { consecutiveLow: requiredSamples } };
  }

  let totalDisplacement = 0;
  for (const key of intersection) {
    const p = prev[key]!;
    const c = current[key]!;
    totalDisplacement += Math.hypot(c.x - p.x, c.y - p.y);
  }
  const avgDisplacement = totalDisplacement / intersection.length;

  if (avgDisplacement < threshold) {
    const newCount = state.consecutiveLow + 1;
    const converged = newCount >= requiredSamples;
    return { converged, displacement: avgDisplacement, state: { consecutiveLow: newCount } };
  }

  return { converged: false, displacement: avgDisplacement, state: { consecutiveLow: 0 } };
}
