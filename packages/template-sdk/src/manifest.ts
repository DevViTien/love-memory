import { SemanticVersionSchema, SlugSchema } from "@love-memory/shared";
import { z } from "zod";

export const TEMPLATE_ENGINE_VERSION = "1.0.0";

const identifierSchema = SlugSchema;

const artifactPathSchema = z
  .string()
  .min(1)
  .max(200)
  .superRefine((value, context) => {
    const segments = value.split("/");
    const unsafe =
      value.startsWith("/") ||
      value.includes("\\") ||
      value.includes(":") ||
      value.includes("?") ||
      value.includes("#") ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..");

    if (unsafe) {
      context.addIssue({
        code: "custom",
        message: "Expected a safe relative artifact path.",
      });
    }
  });

function uniqueIdentifierList(min: number, max: number) {
  return z
    .array(identifierSchema)
    .min(min)
    .max(max)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message: "Identifiers must be unique." });
      }
    });
}

const commonFieldShape = {
  helpText: z.string().max(200).optional(),
  id: identifierSchema,
  label: z.string().min(1).max(80),
  required: z.boolean().default(false),
};

const ShortTextFieldSchema = z
  .object({
    ...commonFieldShape,
    maxLength: z.number().int().positive().max(200),
    type: z.literal("shortText"),
  })
  .strict();

const LongTextFieldSchema = z
  .object({
    ...commonFieldShape,
    maxLength: z.number().int().positive().max(5000),
    type: z.literal("longText"),
  })
  .strict();

const DateFieldSchema = z
  .object({
    ...commonFieldShape,
    type: z.literal("date"),
  })
  .strict();

const imageListShape = {
  ...commonFieldShape,
  aspectRatio: z.string().superRefine((value, context) => {
    const match = /^(\d+):(\d+)$/.exec(value);

    if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
      context.addIssue({ code: "custom", message: "Expected a positive width:height ratio." });
    }
  }),
  maxItems: z.number().int().positive().max(30),
  minItems: z.number().int().nonnegative(),
};

const itemRangeRefinement = [
  (field: { maxItems: number; minItems: number }) => field.minItems <= field.maxItems,
  { message: "minItems must not exceed maxItems" },
] as const;

const ImageListFieldSchema = z
  .object({
    ...imageListShape,
    type: z.literal("imageList"),
  })
  .strict()
  .refine(...itemRangeRefinement);

const CaptionedImageListFieldSchema = z
  .object({
    ...imageListShape,
    captionMaxLength: z.number().int().positive().max(200),
    type: z.literal("captionedImageList"),
  })
  .strict()
  .refine(...itemRangeRefinement);

const ThemeFieldSchema = z
  .object({
    ...commonFieldShape,
    options: uniqueIdentifierList(1, 12),
    type: z.literal("theme"),
  })
  .strict();

const AudioFieldSchema = z
  .object({
    ...commonFieldShape,
    source: z.literal("licensedLibrary"),
    type: z.literal("audio"),
  })
  .strict();

export const TemplateFieldSchema = z.discriminatedUnion("type", [
  ShortTextFieldSchema,
  LongTextFieldSchema,
  DateFieldSchema,
  ImageListFieldSchema,
  CaptionedImageListFieldSchema,
  ThemeFieldSchema,
  AudioFieldSchema,
]);

const fieldsSchema = z
  .array(TemplateFieldSchema)
  .min(1)
  .max(40)
  .superRefine((fields, context) => {
    const seen = new Set<string>();

    for (const [index, field] of fields.entries()) {
      if (seen.has(field.id)) {
        context.addIssue({
          code: "custom",
          message: "Template field ids must be unique.",
          path: [index, "id"],
        });
      }

      seen.add(field.id);
    }
  });

const TemplateStepSchema = z
  .object({
    fieldIds: z.array(identifierSchema).min(1).max(40),
    id: identifierSchema,
    label: z.string().min(1).max(40),
  })
  .strict();

export const DEFAULT_TEMPLATE_STEP = Object.freeze({ id: "content", label: "Nội dung" });

/** Step ids the Studio uses for its own steps after the template steps. */
export const RESERVED_STUDIO_STEP_IDS: readonly string[] = Object.freeze(["preview", "publish"]);

export const TemplateManifestSchema = z
  .object({
    budgets: z
      .object({
        initialJsKbGzip: z.number().int().positive().max(1000),
        initialMediaKb: z.number().int().nonnegative().max(10000),
        maxTextureMb: z.number().int().positive().max(256),
      })
      .strict(),
    capabilities: z
      .array(z.enum(["audio", "canvas2d", "dom", "svg", "webgl"]))
      .max(5)
      .superRefine((capabilities, context) => {
        if (new Set(capabilities).size !== capabilities.length) {
          context.addIssue({ code: "custom", message: "Capabilities must be unique." });
        }
      }),
    engineVersion: SemanticVersionSchema,
    entry: artifactPathSchema,
    fields: fieldsSchema,
    id: identifierSchema,
    meta: z
      .object({
        description: z.string().min(1).max(240),
        estimatedDurationSec: z.number().int().positive().max(600),
        moods: uniqueIdentifierList(1, 8),
        name: z.string().min(1).max(80),
        occasions: uniqueIdentifierList(1, 12),
      })
      .strict(),
    previewFixture: artifactPathSchema,
    status: z.enum(["draft", "published", "retired"]),
    steps: z.array(TemplateStepSchema).min(1).max(8).optional(),
    version: SemanticVersionSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    if (!manifest.steps) return;

    const declared = new Set(manifest.fields.map((field) => field.id));
    const assigned = new Set<string>();
    const stepIds = new Set<string>();

    for (const [stepIndex, step] of manifest.steps.entries()) {
      if (RESERVED_STUDIO_STEP_IDS.includes(step.id)) {
        context.addIssue({
          code: "custom",
          message: `Step id ${step.id} is reserved by the Studio.`,
          path: ["steps", stepIndex, "id"],
        });
      }
      if (stepIds.has(step.id)) {
        context.addIssue({
          code: "custom",
          message: "Template step ids must be unique.",
          path: ["steps", stepIndex, "id"],
        });
      }
      stepIds.add(step.id);

      for (const [fieldIndex, fieldId] of step.fieldIds.entries()) {
        const path = ["steps", stepIndex, "fieldIds", fieldIndex];
        if (!declared.has(fieldId)) {
          context.addIssue({ code: "custom", message: "Step references an unknown field.", path });
        } else if (assigned.has(fieldId)) {
          context.addIssue({
            code: "custom",
            message: "A field must belong to exactly one step.",
            path,
          });
        }
        assigned.add(fieldId);
      }
    }

    for (const fieldId of declared) {
      if (!assigned.has(fieldId)) {
        context.addIssue({
          code: "custom",
          message: `Field ${fieldId} is not assigned to a step.`,
          path: ["steps"],
        });
      }
    }
  });

export type TemplateField = z.infer<typeof TemplateFieldSchema>;
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;
export type TemplateStep = z.infer<typeof TemplateStepSchema>;
export type TemplateImageField = Extract<
  TemplateField,
  { type: "captionedImageList" | "imageList" }
>;

export function isImageField(field: TemplateField): field is TemplateImageField {
  return field.type === "imageList" || field.type === "captionedImageList";
}

export function resolveTemplateSteps(manifest: TemplateManifest): readonly TemplateStep[] {
  return (
    manifest.steps ?? [
      { ...DEFAULT_TEMPLATE_STEP, fieldIds: manifest.fields.map((field) => field.id) },
    ]
  );
}

export function parseTemplateManifest(input: unknown): TemplateManifest {
  return TemplateManifestSchema.parse(input);
}
