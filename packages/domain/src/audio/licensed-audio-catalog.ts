import { SlugSchema } from "@love-memory/shared";
import { z } from "zod";

export const LICENSED_AUDIO_LIMITS = Object.freeze({
  maximumBytes: 8 * 1024 * 1024,
  maximumDurationSec: 600,
});

const AUDIO_FILE_EXTENSIONS = Object.freeze({ "audio/mp4": "m4a", "audio/mpeg": "mp3" });

export const LicensedAudioTrackStatusSchema = z.enum(["active", "withdrawn"]);

export const LicensedAudioTrackSchema = z
  .object({
    artist: z.string().min(1).max(80),
    durationSec: z.number().int().positive().max(LICENSED_AUDIO_LIMITS.maximumDurationSec),
    file: z
      .object({
        bytes: z.number().int().positive().max(LICENSED_AUDIO_LIMITS.maximumBytes),
        fileName: z.string().min(1).max(120),
        mimeType: z.enum(["audio/mpeg", "audio/mp4"]),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
    id: SlugSchema,
    license: z
      .object({
        attribution: z.string().min(1).max(200).optional(),
        kind: z.enum(["purchased", "royalty-free", "commissioned", "project-owned"]),
        reference: z.string().min(1).max(200),
      })
      .strict(),
    status: LicensedAudioTrackStatusSchema,
    title: z.string().min(1).max(80),
  })
  .strict()
  .superRefine((track, context) => {
    const expected = `${track.id}.${track.file.sha256.slice(0, 16)}.${AUDIO_FILE_EXTENSIONS[track.file.mimeType]}`;
    if (track.file.fileName !== expected) {
      context.addIssue({
        code: "custom",
        message: `Expected file name ${expected}.`,
        path: ["file", "fileName"],
      });
    }
  });

export type LicensedAudioTrack = z.infer<typeof LicensedAudioTrackSchema>;

export type LicensedAudioCatalog = Readonly<{
  find: (id: string) => LicensedAudioTrack | undefined;
  listSelectable: () => readonly LicensedAudioTrack[];
  tracks: readonly LicensedAudioTrack[];
}>;

/**
 * Parses an ordered list of track records. Throws when any record is malformed or two records
 * share an id, so a broken catalog fails at import time rather than at playback time.
 */
export function createLicensedAudioCatalog(records: readonly unknown[]): LicensedAudioCatalog {
  const tracks = Object.freeze(
    z
      .array(LicensedAudioTrackSchema)
      .superRefine((parsed, context) => {
        const seen = new Set<string>();
        for (const [index, track] of parsed.entries()) {
          if (seen.has(track.id)) {
            context.addIssue({
              code: "custom",
              message: "Licensed audio track ids must be unique.",
              path: [index, "id"],
            });
          }
          seen.add(track.id);
        }
      })
      .parse(records),
  );
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const selectable = Object.freeze(tracks.filter((track) => track.status === "active"));

  return Object.freeze({
    find: (id: string) => byId.get(id),
    listSelectable: () => selectable,
    tracks,
  });
}

/**
 * Tracks the product holds a license for, in presentation order. A released track's id, file and
 * license never change and the track is never removed: set `status` to `withdrawn` instead, and add
 * a different recording as a new track. Each file lives in `apps/web/public/audio-library/`.
 */
const LICENSED_AUDIO_TRACKS: readonly unknown[] = [];

export const licensedAudioCatalog = createLicensedAudioCatalog(LICENSED_AUDIO_TRACKS);
