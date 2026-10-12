import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ isKilled: vi.fn() }));
const html = vi.hoisted(() => ({ findArtifact: vi.fn() }));
const storage = vi.hoisted(() => ({ getObject: vi.fn() }));

vi.mock("@/modules/templates/infrastructure/mongo-template-version-state", () => ({
  mongoTemplateVersionState: { isKilled: state.isKilled },
}));

vi.mock("@/modules/templates/infrastructure/mongo-html-template-repository", () => ({
  mongoHtmlTemplateRepository: { findArtifact: html.findArtifact },
}));

vi.mock("./storage", () => ({ createStorage: () => storage }));

import {
  findTemplateArtifact,
  isTemplateVersionAvailable,
  resolveTemplateArtifact,
} from "./templates";

const htmlHash = "a".repeat(64);

describe("template artifact resolution", () => {
  beforeEach(() => {
    state.isKilled.mockReset();
    html.findArtifact.mockReset();
    html.findArtifact.mockResolvedValue(null);
  });

  it("uses the registered artifact of a version that is not killed", async () => {
    state.isKilled.mockResolvedValueOnce(false);

    const artifact = await resolveTemplateArtifact("memory-box", "1.1.0");

    expect(artifact).toMatchObject({
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
      kind: "sdk",
    });
    expect(state.isKilled).toHaveBeenCalledWith("memory-box", "1.1.0");
    expect(html.findArtifact).not.toHaveBeenCalled();
    const index = await artifact?.readFile("index.html");
    expect(index?.contentType).toBe("text/html; charset=utf-8");
    expect(new TextDecoder().decode(index?.body)).toContain("<!doctype html>");
    await expect(artifact?.readFile("private.txt")).resolves.toBeNull();
    await expect(artifact?.readFile("toString")).resolves.toBeNull();
  });

  it("treats a killed version as one without an artifact (Effect of a killed version)", async () => {
    state.isKilled.mockResolvedValueOnce(true);

    await expect(resolveTemplateArtifact("memory-box", "1.1.0")).resolves.toBeNull();
  });

  it("does not read the kill state of a version without an artifact", async () => {
    await expect(resolveTemplateArtifact("memory-box", "1.0.0")).resolves.toBeNull();
    expect(html.findArtifact).toHaveBeenCalledWith("memory-box", "1.0.0");
    expect(state.isKilled).not.toHaveBeenCalled();
  });

  it("resolves an imported html version from its stored document (HTML version availability)", async () => {
    html.findArtifact.mockResolvedValue({ artifactContentHash: htmlHash, files: [] });
    state.isKilled.mockResolvedValueOnce(false);

    await expect(resolveTemplateArtifact("love-days", "1.0.0")).resolves.toMatchObject({
      contentHash: htmlHash,
      id: "love-days",
      kind: "html",
      version: "1.0.0",
    });
    await expect(isTemplateVersionAvailable("love-days", "1.0.0")).resolves.toBe(true);
    await expect(findTemplateArtifact("love-days", "1.0.0")).resolves.toMatchObject({
      kind: "html",
    });
    html.findArtifact.mockResolvedValue(null);
    await expect(isTemplateVersionAvailable("love-days", "9.9.9")).resolves.toBe(false);
  });
});
