import { describe, expect, it } from "vitest";

import { FEATURE_FLAGS, isFeatureEnabled } from "./feature-flags";

describe("feature flags", () => {
  it.each(Object.keys(FEATURE_FLAGS) as (keyof typeof FEATURE_FLAGS)[])(
    "returns the configured value for %s",
    (flag) => {
      expect(isFeatureEnabled(flag)).toBe(FEATURE_FLAGS[flag]);
    },
  );
});
