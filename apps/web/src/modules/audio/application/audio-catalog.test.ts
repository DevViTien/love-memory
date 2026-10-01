import { LicensedAudioTrackDtoSchema } from "@love-memory/contracts";
import { createLicensedAudioCatalog } from "@love-memory/domain";
import { describe, expect, it } from "vitest";

import { createAudioCatalogService } from "./audio-catalog";

const sha256 = `3f9a0c1d2e4b5a67${"0".repeat(48)}`;

function track(id: string, status: "active" | "withdrawn") {
  return {
    artist: "Nhóm Sóng",
    durationSec: 128,
    file: {
      bytes: 2_048_000,
      fileName: `${id}.3f9a0c1d2e4b5a67.mp3`,
      mimeType: "audio/mpeg",
      sha256,
    },
    id,
    license: { kind: "purchased", reference: "INV-2026-0042" },
    status,
    title: "Buổi sáng mộc",
  };
}

const service = createAudioCatalogService(
  createLicensedAudioCatalog([
    track("acoustic-morning", "active"),
    track("old-piano", "withdrawn"),
  ]),
);

describe("audio catalog service", () => {
  it("offers only active tracks as browser DTOs without license data", () => {
    const tracks = service.listSelectableTracks();

    expect(tracks).toEqual([
      {
        artist: "Nhóm Sóng",
        durationSec: 128,
        id: "acoustic-morning",
        title: "Buổi sáng mộc",
        url: "/audio-library/acoustic-morning.3f9a0c1d2e4b5a67.mp3",
      },
    ]);
    expect(tracks.every((dto) => LicensedAudioTrackDtoSchema.safeParse(dto).success)).toBe(true);
  });

  it("treats only active catalog ids as selectable", () => {
    expect(service.isSelectableTrack("acoustic-morning")).toBe(true);
    expect(service.isSelectableTrack("old-piano")).toBe(false);
    expect(service.isSelectableTrack("unknown-track")).toBe(false);
  });

  it("finds the DTO of an active track only", () => {
    expect(service.findSelectableTrack("acoustic-morning")).toEqual({
      artist: "Nhóm Sóng",
      durationSec: 128,
      id: "acoustic-morning",
      title: "Buổi sáng mộc",
      url: "/audio-library/acoustic-morning.3f9a0c1d2e4b5a67.mp3",
    });
    expect(service.findSelectableTrack("old-piano")).toBeNull();
    expect(service.findSelectableTrack("unknown-track")).toBeNull();
  });

  it("handles an empty catalog", () => {
    const empty = createAudioCatalogService(createLicensedAudioCatalog([]));

    expect(empty.listSelectableTracks()).toEqual([]);
    expect(empty.isSelectableTrack("acoustic-morning")).toBe(false);
  });
});
