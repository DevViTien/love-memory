import { SlugSchema } from "@love-memory/shared";
import { z } from "zod";

import { isImageField, type TemplateField, type TemplateManifest } from "./manifest";

export type CaptionedImageItem = Readonly<{ assetId: string; caption?: string }>;

export type ImageFieldReferences = Readonly<{ assetIds: readonly string[]; fieldId: string }>;

type FieldSchemaMode = "draft" | "full";

/**
 * A draft may hold fewer images than `minItems` so that images can be saved one at a time;
 * every other rule applies in both modes.
 */
function createFieldValueSchema(field: TemplateField, mode: FieldSchemaMode): z.ZodType {
  switch (field.type) {
    case "shortText":
      return z.string().trim().min(1).max(field.maxLength);
    case "longText":
      return z.string().trim().min(1).max(field.maxLength);
    case "date":
      return z.iso.date();
    case "imageList":
      return z
        .array(z.uuid())
        .min(mode === "full" ? field.minItems : 0)
        .max(field.maxItems)
        .refine((assetIds) => new Set(assetIds).size === assetIds.length, {
          message: "Image asset references must be unique.",
        });
    case "captionedImageList":
      return z
        .array(
          z
            .object({
              assetId: z.uuid(),
              caption: z.string().trim().min(1).max(field.captionMaxLength).optional(),
            })
            .strict(),
        )
        .min(mode === "full" ? field.minItems : 0)
        .max(field.maxItems)
        .refine((items) => new Set(items.map((item) => item.assetId)).size === items.length, {
          message: "Image asset references must be unique.",
        });
    case "theme":
      return z.string().refine((value) => field.options.includes(value), {
        message: "Theme is not declared by this template version.",
      });
    case "audio":
      return SlugSchema;
  }
}

export function createTemplatePayloadSchema(
  manifest: TemplateManifest,
): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};

  for (const field of manifest.fields) {
    const valueSchema = createFieldValueSchema(field, "full");
    shape[field.id] = field.required ? valueSchema : valueSchema.optional();
  }

  return z.object(shape).strict();
}

export function createTemplateDraftPayloadSchema(
  manifest: TemplateManifest,
): z.ZodObject<Record<string, z.ZodOptional<z.ZodType>>> {
  const shape: Record<string, z.ZodOptional<z.ZodType>> = {};

  for (const field of manifest.fields) {
    shape[field.id] = createFieldValueSchema(field, "draft").optional();
  }

  return z.object(shape).strict();
}

export function parseTemplatePayload(manifest: TemplateManifest, input: unknown) {
  return createTemplatePayloadSchema(manifest).parse(input);
}

export function parseTemplateDraftPayload(manifest: TemplateManifest, input: unknown) {
  return createTemplateDraftPayloadSchema(manifest).parse(input);
}

/**
 * Asset references per image field of already validated content, in field declaration order.
 * Fields that are omitted or empty are skipped.
 */
export function listImageFieldReferences(
  manifest: TemplateManifest,
  content: Readonly<Record<string, unknown>>,
): ImageFieldReferences[] {
  return manifest.fields.flatMap((field): ImageFieldReferences[] => {
    if (!isImageField(field)) return [];
    const value = content[field.id];
    if (!Array.isArray(value) || value.length === 0) return [];

    // Stored content is untrusted input: a malformed item is skipped, never dereferenced, so it
    // fails the later validation as a missing reference instead of throwing (a 500).
    const assetIds =
      field.type === "imageList"
        ? (value as unknown[]).filter((item): item is string => typeof item === "string")
        : (value as unknown[]).flatMap((item) =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as Partial<CaptionedImageItem>).assetId === "string"
              ? [(item as CaptionedImageItem).assetId]
              : [],
          );
    if (assetIds.length === 0) return [];
    return [{ assetIds, fieldId: field.id }];
  });
}
