import { describe, expect, it } from "vitest";

import { LicensedAudioTrackDtoSchema } from "./audio";

const dto = {
  artist: "Nhóm Sóng",
  durationSec: 128,
  id: "acoustic-morning",
  title: "Buổi sáng mộc",
  url: "/audio-library/acoustic-morning.3f9a0c1d2e4b5a67.mp3",
};

describe("LicensedAudioTrackDtoSchema", () => {
  it("accepts the browser track shape", () => {
    expect(LicensedAudioTrackDtoSchema.parse(dto)).toEqual(dto);
  });

  it.each([
    { ...dto, license: { kind: "purchased", reference: "INV-1" } },
    { ...dto, sha256: "0".repeat(64) },
    { ...dto, url: "https://store.example/acoustic-morning.mp3" },
  ])("rejects license data, digests and non-catalog URLs %#", (value) => {
    expect(LicensedAudioTrackDtoSchema.safeParse(value).success).toBe(false);
  });
});
