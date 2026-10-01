import {
  parseTemplateDraftPayload,
  parseTemplateManifest,
  parseTemplatePayload,
  TemplateHostMessageSchema,
  type TemplateManifest,
} from "@love-memory/template-sdk";
import { describe, expect, it } from "vitest";

import { MEMORY_BOX_HARNESS_FIXTURES } from "./fixtures";
import { type MemoryBoxHarnessFixture, MEMORY_BOX_RELEASES } from "./index";

const release = MEMORY_BOX_RELEASES.find((entry) => entry.version === "1.1.0");
const manifest = parseTemplateManifest(release?.manifest);
const fixtures_1_1_0 = MEMORY_BOX_HARNESS_FIXTURES["1.1.0"] ?? {};
const DRAFT_ONLY_FIXTURES = new Set(["missing-fields"]);

/** Names every fixture that fails full (or, for `missing-fields`, draft) payload validation. */
function findInvalidFixtures(
  templateManifest: TemplateManifest,
  fixtures: Readonly<Record<string, MemoryBoxHarnessFixture>>,
): string[] {
  return Object.entries(fixtures).flatMap(([name, fixture]) => {
    try {
      if (DRAFT_ONLY_FIXTURES.has(name))
        parseTemplateDraftPayload(templateManifest, fixture.payload);
      else parseTemplatePayload(templateManifest, fixture.payload);
      return [];
    } catch {
      return [name];
    }
  });
}

describe.each(MEMORY_BOX_RELEASES.map((entry) => [entry.version, entry] as const))(
  "harness fixtures of release %s",
  (version, entry) => {
    it("exist and validate against that release's manifest", () => {
      const fixtures = MEMORY_BOX_HARNESS_FIXTURES[version];
      expect(fixtures).toBeDefined();
      expect(findInvalidFixtures(parseTemplateManifest(entry.manifest), fixtures ?? {})).toEqual(
        [],
      );
      expect(fixtures?.["default"]?.payload).toEqual(entry.previewFixture);
    });
  },
);

describe("Viewer harness fixtures", () => {
  it("are keyed by released version only", () => {
    expect(Object.keys(MEMORY_BOX_HARNESS_FIXTURES)).toEqual(
      MEMORY_BOX_RELEASES.map((entry) => entry.version),
    );
  });

  it("ships default, max-length, missing-fields and broken-image", () => {
    expect(Object.keys(fixtures_1_1_0)).toEqual([
      "default",
      "max-length",
      "missing-fields",
      "broken-image",
    ]);
  });

  it("validates every fixture against the manifest", () => {
    expect(findInvalidFixtures(manifest, fixtures_1_1_0)).toEqual([]);
    expect(() =>
      parseTemplatePayload(manifest, fixtures_1_1_0["missing-fields"]?.payload),
    ).toThrow();
  });

  it("fails naming a fixture made invalid", () => {
    const broken = {
      ...fixtures_1_1_0,
      "max-length": {
        assets: {},
        payload: { ...fixtures_1_1_0["max-length"]?.payload, theme: "ocean" },
      },
    };

    expect(findInvalidFixtures(manifest, broken)).toEqual(["max-length"]);
  });

  it("sends only inline data: images that the host INIT schema accepts", () => {
    for (const fixture of Object.values(fixtures_1_1_0)) {
      for (const url of Object.values(fixture.assets)) {
        expect(url.startsWith("data:image/")).toBe(true);
        expect(url.length).toBeLessThan(1500);
      }
      expect(
        TemplateHostMessageSchema.safeParse({
          assets: fixture.assets,
          context: { locale: "vi-VN", prefersReducedMotion: false },
          payload: fixture.payload,
          protocolVersion: 1,
          type: "INIT",
        }).success,
      ).toBe(true);
    }
  });

  it("uses the release preview fixture with an image for each of its 5 photos", () => {
    const fixture = fixtures_1_1_0["default"];
    const memories = (release?.previewFixture["memories"] ?? []) as Array<{ assetId: string }>;
    expect(fixture?.payload).toEqual(release?.previewFixture);
    expect(memories).toHaveLength(5);
    expect(Object.keys(fixture?.assets ?? {})).toEqual(memories.map((memory) => memory.assetId));
  });

  it("fills every text field of max-length to its limit with 8 photos", () => {
    const payload = fixtures_1_1_0["max-length"]?.payload as Record<string, unknown>;
    const memories = payload["memories"] as Array<{ caption: string }>;

    expect(String(payload["receiver-name"]).trim()).toHaveLength(40);
    expect(String(payload["opening-message"]).trim()).toHaveLength(120);
    expect(String(payload["final-letter"]).trim()).toHaveLength(1200);
    expect(memories).toHaveLength(8);
    expect(memories.every((memory) => memory.caption.trim().length === 140)).toBe(true);
    expect(JSON.stringify(payload)).toMatch(/[ảễ].*\p{Extended_Pictographic}/u);
  });

  it("breaks exactly two photos in broken-image", () => {
    const fixture = fixtures_1_1_0["broken-image"];
    const memories = fixture?.payload["memories"] as Array<{ assetId: string }>;
    const urls = memories.map((memory) => fixture?.assets[memory.assetId]);

    expect(urls.filter((url) => url === undefined)).toHaveLength(1);
    expect(urls.filter((url) => url === "data:image/png;base64,AAAA")).toHaveLength(1);
  });
});
