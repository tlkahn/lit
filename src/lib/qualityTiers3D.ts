export type Quality3DTier = "high" | "medium" | "low" | "minimal";

export interface Quality3DTierSettings {
  tier: Quality3DTier;
  sphereWidthSegments: number;
  sphereHeightSegments: number;
  edgeOpacity: number;
  raycastStrategy: "per-frame" | "throttled";
  raycastThrottleMs: number;
}

const TIERS: Record<Quality3DTier, Omit<Quality3DTierSettings, "tier">> = {
  high: { sphereWidthSegments: 16, sphereHeightSegments: 12, edgeOpacity: 0.5, raycastStrategy: "per-frame", raycastThrottleMs: 0 },
  medium: { sphereWidthSegments: 8, sphereHeightSegments: 6, edgeOpacity: 0.35, raycastStrategy: "per-frame", raycastThrottleMs: 0 },
  low: { sphereWidthSegments: 4, sphereHeightSegments: 3, edgeOpacity: 0.2, raycastStrategy: "throttled", raycastThrottleMs: 100 },
  minimal: { sphereWidthSegments: 3, sphereHeightSegments: 2, edgeOpacity: 0.15, raycastStrategy: "throttled", raycastThrottleMs: 200 },
};

export function get3DQualityTier(nodeCount: number): Quality3DTier {
  if (nodeCount < 500) return "high";
  if (nodeCount < 2000) return "medium";
  if (nodeCount < 5000) return "low";
  return "minimal";
}

export function get3DTierSettings(tier: Quality3DTier): Quality3DTierSettings {
  return { tier, ...TIERS[tier] };
}

export function get3DQualitySettings(nodeCount: number): Quality3DTierSettings {
  return get3DTierSettings(get3DQualityTier(nodeCount));
}
