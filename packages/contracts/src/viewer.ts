import { z } from "zod";

import { createApiSuccessSchema } from "./api";

export const ViewerFieldTypeSchema = z.enum([
  "audio",
  "captionedImageList",
  "date",
  "imageList",
  "longText",
  "shortText",
  "theme",
]);

export const ViewerFieldDtoSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    maxItems: z.number().int().nonnegative().exactOptional(),
    minItems: z.number().int().nonnegative().exactOptional(),
    required: z.boolean(),
    type: ViewerFieldTypeSchema,
  })
  .strict();

/**
 * The viewer payload a recipient receives: the output of the shared payload builder without the
 * creator-only `issues`. Paths are same-origin; asset URLs are short-lived signed URLs.
 */
export const ViewerPayloadDtoSchema = z
  .object({
    artifactUrl: z
      .string()
      .regex(/^\/template-artifacts\/[^/?#]+\/[^/?#]+\/[a-f0-9]{64}\/index\.html$/)
      .nullable(),
    assets: z.record(z.string(), z.string().min(1)),
    assetsExpireAt: z.iso.datetime().nullable(),
    audioUrl: z
      .string()
      .regex(/^\/audio-library\/[^?#]+$/)
      .nullable(),
    fields: z.array(ViewerFieldDtoSchema),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

/** `GET /api/public-gifts/{shareId}`. */
export const PublicGiftResponseSchema = createApiSuccessSchema(
  z.object({ viewer: ViewerPayloadDtoSchema }).strict(),
);

export type ViewerFieldDto = z.infer<typeof ViewerFieldDtoSchema>;
export type ViewerPayloadDto = z.infer<typeof ViewerPayloadDtoSchema>;
export type PublicGiftResponse = z.infer<typeof PublicGiftResponseSchema>;
