import { describe, expect, it } from "vitest";

import { getTemplateArtifact, getTemplateFixture } from "./template-artifact-registry";

describe("template artifact registry", () => {
  it("returns one immutable exact-version artifact with a content hash", () => {
    const artifact = getTemplateArtifact("memory-box-spike", "0.1.0");
    expect(artifact).toMatchObject({ id: "memory-box-spike", version: "0.1.0" });
    expect(artifact?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact?.files["index.html"]?.body).toContain("sandbox runtime");
    expect(artifact?.files["runtime.mjs"]?.contentType).toContain("javascript");
    expect(getTemplateArtifact("memory-box-spike", "0.2.0")).toBeNull();
    expect(getTemplateFixture("memory-box-spike", "0.1.0", "max-length")).toMatchObject({
      theme: "warm-paper",
    });
    expect(getTemplateFixture("memory-box-spike", "0.1.0", "unknown")).toBeNull();
  });
});
