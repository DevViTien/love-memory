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

/** The template kinds: `sdk` is built in the repository, `html` is imported as data. */
export const TEMPLATE_KINDS = ["sdk", "html"] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** The entry document of every `html` template version. */
export const HTML_TEMPLATE_ENTRY = "index.html";

const CONFIG_PATH_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Segments that would reach an object prototype when a value is merged by path. */
const FORBIDDEN_CONFIG_PATH_SEGMENTS: readonly string[] = ["__proto__", "constructor", "prototype"];

/**
 * A dot path into the default configuration of an `html` template, such as `person1.name`: 1 to 8
 * identifier segments, at most 200 characters in all, never a prototype key.
 */
export const ConfigPathSchema = z
  .string()
  .min(1)
  .max(200)
  .superRefine((value, context) => {
    const segments = value.split(".");
    const valid =
      segments.length <= 8 &&
      segments.every(
        (segment) =>
          CONFIG_PATH_SEGMENT.test(segment) && !FORBIDDEN_CONFIG_PATH_SEGMENTS.includes(segment),
      );
    if (!valid) {
      context.addIssue({ code: "custom", message: "Expected a dot path of identifier segments." });
    }
  });

const commonFieldShape = {
  helpText: z.string().max(200).optional(),
  id: identifierSchema,
  label: z.string().min(1).max(80),
  /** Where an `html` template reads the value in its configuration; absent for `sdk` templates. */
  path: ConfigPathSchema.optional(),
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

const aspectRatioSchema = z.string().superRefine((value, context) => {
  const match = /^(\d+):(\d+)$/.exec(value);

  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
    context.addIssue({ code: "custom", message: "Expected a positive width:height ratio." });
  }
});

/** The crop frame of an `image` field that declares no `aspectRatio`. */
export const DEFAULT_IMAGE_ASPECT_RATIO = "1:1";

const imageListShape = {
  ...commonFieldShape,
  aspectRatio: aspectRatioSchema,
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

const TextListFieldSchema = z
  .object({
    ...commonFieldShape,
    itemMaxLength: z.number().int().positive().max(500),
    maxItems: z.number().int().positive().max(50),
    minItems: z.number().int().nonnegative(),
    type: z.literal("textList"),
  })
  .strict()
  .refine(...itemRangeRefinement);

const ImageFieldSchema = z
  .object({
    ...commonFieldShape,
    aspectRatio: aspectRatioSchema.optional(),
    type: z.literal("image"),
  })
  .strict();

const PasscodeFieldSchema = z
  .object({
    ...commonFieldShape,
    length: z.number().int().min(4).max(8),
    type: z.literal("passcode"),
  })
  .strict();

const ColorFieldSchema = z
  .object({
    ...commonFieldShape,
    type: z.literal("color"),
  })
  .strict();

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
  TextListFieldSchema,
  ImageFieldSchema,
  PasscodeFieldSchema,
  ColorFieldSchema,
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

type PathCheckedManifest = Readonly<{
  entry: string;
  fields: readonly Readonly<{ path?: string | undefined; type: string }>[];
  kind?: TemplateKind | undefined;
}>;

/**
 * `html` fields map into the template configuration: every field but `audio` (the host plays the
 * music) has a path, no path repeats or contains another, and the entry is `index.html`. `sdk`
 * fields have no path.
 */
function checkFieldPaths(manifest: PathCheckedManifest, context: z.RefinementCtx): void {
  const html = manifest.kind === "html";
  if (html && manifest.entry !== HTML_TEMPLATE_ENTRY) {
    context.addIssue({
      code: "custom",
      message: `An html template's entry must be ${HTML_TEMPLATE_ENTRY}.`,
      path: ["entry"],
    });
  }
  const seen: string[] = [];
  for (const [index, field] of manifest.fields.entries()) {
    const path = ["fields", index, "path"];
    if (!html || field.type === "audio") {
      if (field.path !== undefined) {
        context.addIssue({
          code: "custom",
          message: html ? "An audio field has no path." : "Only html template fields have a path.",
          path,
        });
      }
      continue;
    }
    if (field.path === undefined) {
      context.addIssue({ code: "custom", message: "An html template field needs a path.", path });
      continue;
    }
    const current = field.path;
    const overlaps = seen.some(
      (other) =>
        other === current || other.startsWith(`${current}.`) || current.startsWith(`${other}.`),
    );
    if (overlaps) {
      context.addIssue({
        code: "custom",
        message: "Field paths must not repeat or contain one another.",
        path,
      });
    }
    seen.push(current);
  }
}

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
    /** Absent means `sdk`, so manifests written before kinds existed stay valid unchanged. */
    kind: z.enum(TEMPLATE_KINDS).optional(),
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
    checkFieldPaths(manifest, context);
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
export type TemplateFieldType = TemplateField["type"];
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;
export type TemplateStep = z.infer<typeof TemplateStepSchema>;
export type TemplateImageField = Extract<
  TemplateField,
  { type: "captionedImageList" | "image" | "imageList" }
>;
export type TemplateListField = Extract<
  TemplateField,
  { type: "captionedImageList" | "imageList" | "textList" }
>;

/** Fields whose values reference uploaded photos by asset id. */
export function isImageField(field: TemplateField): field is TemplateImageField {
  return (
    field.type === "imageList" || field.type === "captionedImageList" || field.type === "image"
  );
}

/** Fields whose values are lists with `minItems` and `maxItems`. */
export function isListField(field: TemplateField): field is TemplateListField {
  return (
    field.type === "imageList" || field.type === "captionedImageList" || field.type === "textList"
  );
}

/**
 * How many photos an image field holds: its `minItems` and `maxItems`, or for a single `image`
 * one photo, required only when the field is.
 */
export function imageFieldItemRange(
  field: TemplateImageField,
): Readonly<{ maxItems: number; minItems: number }> {
  return field.type === "image"
    ? { maxItems: 1, minItems: field.required ? 1 : 0 }
    : { maxItems: field.maxItems, minItems: field.minItems };
}

/** The kind of a manifest: `sdk` unless it declares `html`. */
export function templateKindOf(
  manifest: Readonly<{ kind?: TemplateKind | undefined }>,
): TemplateKind {
  return manifest.kind ?? "sdk";
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
