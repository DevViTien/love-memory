export const FEATURE_FLAGS = {
  payments: false,
  reactions: false,
  scheduledReveal: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag];
}
