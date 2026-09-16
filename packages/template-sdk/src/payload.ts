import { z } from "zod";

import { type TemplateField, type TemplateManifest } from "./manifest";

function createFieldValueSchema(field: TemplateField): z.ZodType {
  switch (field.type) {
    case "shortText":
      return z.string().trim().min(1).max(field.maxLength);
    case "longText":
      return z.string().trim().min(1).max(field.maxLength);
    case "date":
      return z.iso.date();
    case "imageList":
      return z.array(z.string().min(1).max(160)).min(field.minItems).max(field.maxItems);
    case "theme":
      return z.string().refine((value) => field.options.includes(value), {
        message: "Theme is not declared by this template version.",
      });
    case "audio":
      return z.string().min(1).max(160);
  }
}

export function createTemplatePayloadSchema(
  manifest: TemplateManifest,
): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};

  for (const field of manifest.fields) {
    const valueSchema = createFieldValueSchema(field);
    shape[field.id] = field.required ? valueSchema : valueSchema.optional();
  }

  return z.object(shape).strict();
}

export function createTemplateDraftPayloadSchema(
  manifest: TemplateManifest,
): z.ZodObject<Record<string, z.ZodOptional<z.ZodType>>> {
  const shape: Record<string, z.ZodOptional<z.ZodType>> = {};

  for (const field of manifest.fields) {
    shape[field.id] = createFieldValueSchema(field).optional();
  }

  return z.object(shape).strict();
}

export function parseTemplatePayload(manifest: TemplateManifest, input: unknown) {
  return createTemplatePayloadSchema(manifest).parse(input);
}

export function parseTemplateDraftPayload(manifest: TemplateManifest, input: unknown) {
  return createTemplateDraftPayloadSchema(manifest).parse(input);
}
