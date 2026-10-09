import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ isKilled: vi.fn() }));

vi.mock("@/modules/templates/infrastructure/mongo-template-version-state", () => ({
  mongoTemplateVersionState: { isKilled: state.isKilled },
}));

import { resolveTemplateArtifact } from "./templates";

describe("template artifact resolution", () => {
  beforeEach(() => {
    state.isKilled.mockReset();
  });

  it("uses the registered artifact of a version that is not killed", async () => {
    state.isKilled.mockResolvedValueOnce(false);

    await expect(resolveTemplateArtifact("memory-box", "1.1.0")).resolves.toMatchObject({
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
    });
    expect(state.isKilled).toHaveBeenCalledWith("memory-box", "1.1.0");
  });

  it("treats a killed version as one without an artifact (Effect of a killed version)", async () => {
    state.isKilled.mockResolvedValueOnce(true);

    await expect(resolveTemplateArtifact("memory-box", "1.1.0")).resolves.toBeNull();
  });

  it("does not read the kill state of a version without a registered artifact", async () => {
    await expect(resolveTemplateArtifact("memory-box", "1.0.0")).resolves.toBeNull();
    expect(state.isKilled).not.toHaveBeenCalled();
  });
});
