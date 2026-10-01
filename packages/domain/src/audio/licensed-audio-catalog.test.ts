import { describe, expect, it } from "vitest";

import { createLicensedAudioCatalog, licensedAudioCatalog } from "./licensed-audio-catalog";

const sha256 = `3f9a0c1d2e4b5a67${"0".repeat(48)}`;

function track(overrides: Record<string, unknown> = {}) {
  return {
    artist: "Nhóm Sóng",
    durationSec: 128,
    file: {
      bytes: 2_048_000,
      fileName: "acoustic-morning.3f9a0c1d2e4b5a67.mp3",
      mimeType: "audio/mpeg",
      sha256,
    },
    id: "acoustic-morning",
    license: { kind: "purchased", reference: "INV-2026-0042" },
    status: "active",
    title: "Buổi sáng mộc",
    ...overrides,
  };
}

describe("licensed audio catalog", () => {
  it("loads a valid track and looks it up by id", () => {
    const catalog = createLicensedAudioCatalog([track()]);

    expect(catalog.find("acoustic-morning")).toMatchObject({ title: "Buổi sáng mộc" });
  });

  it("accepts m4a files named after their mime type", () => {
    const catalog = createLicensedAudioCatalog([
      track({
        file: {
          bytes: 1000,
          fileName: "acoustic-morning.3f9a0c1d2e4b5a67.m4a",
          mimeType: "audio/mp4",
          sha256,
        },
      }),
    ]);

    expect(catalog.tracks).toHaveLength(1);
  });

  it.each([
    ["a duplicate id", [track(), track()]],
    ["a missing license reference", [track({ license: { kind: "purchased" } })]],
    [
      "a file name that does not match the id",
      [track({ file: { ...track().file, fileName: "other.3f9a0c1d2e4b5a67.mp3" } })],
    ],
    [
      "a file name that does not match the mime type",
      [track({ file: { ...track().file, mimeType: "audio/mp4" } })],
    ],
    ["an uppercase digest", [track({ file: { ...track().file, sha256: sha256.toUpperCase() } })]],
    ["an oversized file", [track({ file: { ...track().file, bytes: 8 * 1024 * 1024 + 1 } })]],
    ["an unknown key", [track({ previewUrl: "https://example.com/a.mp3" })]],
    ["an unknown license kind", [track({ license: { kind: "borrowed", reference: "x" } })]],
  ])("fails to load with %s", (_, records) => {
    expect(() => createLicensedAudioCatalog(records)).toThrow();
  });

  it("loads an empty catalog with nothing selectable", () => {
    const catalog = createLicensedAudioCatalog([]);

    expect(catalog.listSelectable()).toEqual([]);
    expect(catalog.find("acoustic-morning")).toBeUndefined();
  });

  it("keeps withdrawn tracks resolvable but not selectable", () => {
    const catalog = createLicensedAudioCatalog([
      track(),
      track({
        file: { ...track().file, fileName: "old-piano.3f9a0c1d2e4b5a67.mp3" },
        id: "old-piano",
        status: "withdrawn",
      }),
    ]);

    expect(catalog.find("old-piano")).toMatchObject({ status: "withdrawn" });
    expect(catalog.listSelectable().map((entry) => entry.id)).toEqual(["acoustic-morning"]);
    expect(catalog.find("unknown-track")).toBeUndefined();
  });

  it("loads the committed catalog", () => {
    expect(() => licensedAudioCatalog.listSelectable()).not.toThrow();
  });
});
