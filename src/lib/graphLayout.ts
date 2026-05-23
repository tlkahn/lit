const DEFAULT_ACCENT = "#0969da";
const DEFAULT_STUB = "#818b98";
const DEFAULT_DIM = "#d1d9e0";
const DEFAULT_EDGE = "#818b98";
const DEFAULT_LABEL = "#1f2328";

export function resolveThemeColors(): { accentColor: string; stubColor: string; dimColor: string; edgeColor: string; labelColor: string } {
  if (typeof document === "undefined") {
    return { accentColor: DEFAULT_ACCENT, stubColor: DEFAULT_STUB, dimColor: DEFAULT_DIM, edgeColor: DEFAULT_EDGE, labelColor: DEFAULT_LABEL };
  }
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue("--interactive-accent").trim();
  const stub = style.getPropertyValue("--text-faint").trim();
  const dim = style.getPropertyValue("--background-modifier-border").trim();
  const edge = style.getPropertyValue("--text-faint").trim();
  const label = style.getPropertyValue("--text-normal").trim();
  return {
    accentColor: accent || DEFAULT_ACCENT,
    stubColor: stub || DEFAULT_STUB,
    dimColor: dim || DEFAULT_DIM,
    edgeColor: edge || DEFAULT_EDGE,
    labelColor: label || DEFAULT_LABEL,
  };
}

export const MIN_SIZE = 4;
export const MAX_SIZE = 30;
export const SCALE_K = 1000;

export function computeNodeSize(pr: number, maxPr: number): number {
  if (pr <= 0 || maxPr <= 0) return MIN_SIZE;
  return MIN_SIZE + (MAX_SIZE - MIN_SIZE) * Math.log(1 + pr * SCALE_K) / Math.log(1 + maxPr * SCALE_K);
}

export const SEED_COLOR = "#f59e0b";
