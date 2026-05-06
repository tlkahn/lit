export type QualityTier = "small" | "medium" | "large" | "huge";

export interface TierSettings {
  tier: QualityTier;
  labelRenderedSizeThreshold: number;
  enableEdgeEvents: boolean;
  hideEdgesOnMove: boolean;
  hideLabelsOnMove: boolean;
  defaultEdgesHidden: boolean;
}

const TIERS: Record<QualityTier, Omit<TierSettings, "tier">> = {
  small: { labelRenderedSizeThreshold: 0, enableEdgeEvents: true, hideEdgesOnMove: false, hideLabelsOnMove: false, defaultEdgesHidden: false },
  medium: { labelRenderedSizeThreshold: 6, enableEdgeEvents: false, hideEdgesOnMove: false, hideLabelsOnMove: false, defaultEdgesHidden: false },
  large: { labelRenderedSizeThreshold: 12, enableEdgeEvents: false, hideEdgesOnMove: true, hideLabelsOnMove: true, defaultEdgesHidden: false },
  huge: { labelRenderedSizeThreshold: 12, enableEdgeEvents: false, hideEdgesOnMove: true, hideLabelsOnMove: true, defaultEdgesHidden: true },
};

export function getQualityTier(order: number): QualityTier {
  if (order < 1000) return "small";
  if (order < 5000) return "medium";
  if (order < 20000) return "large";
  return "huge";
}

export function getTierSettings(tier: QualityTier): TierSettings {
  return { tier, ...TIERS[tier] };
}

export function getQualitySettings(order: number): TierSettings {
  return getTierSettings(getQualityTier(order));
}
