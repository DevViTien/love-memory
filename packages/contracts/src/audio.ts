import { LICENSED_AUDIO_LIMITS } from "@love-memory/domain";
import { SlugSchema } from "@love-memory/shared";
import { z } from "zod";

export const LicensedAudioTrackDtoSchema = z
  .object({
    artist: z.string().min(1).max(80),
    durationSec: z.number().int().positive().max(LICENSED_AUDIO_LIMITS.maximumDurationSec),
    id: SlugSchema,
    title: z.string().min(1).max(80),
    url: z.string().regex(/^\/audio-library\/[a-z0-9-]+\.[0-9a-f]{16}\.(?:mp3|m4a)$/),
  })
  .strict();

export type LicensedAudioTrackDto = z.infer<typeof LicensedAudioTrackDtoSchema>;
