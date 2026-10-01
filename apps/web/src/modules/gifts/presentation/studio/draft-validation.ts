import {
  createTemplateDraftPayloadSchema,
  createTemplatePayloadSchema,
  type TemplateField,
  type TemplateManifest,
} from "@love-memory/template-sdk";

import { type StudioStep } from "./studio-steps";

export type DraftContent = Readonly<Record<string, unknown>>;

/** Messages keyed by field id. */
export type FieldErrors = Readonly<Record<string, string>>;

export type MappedServerErrors = Readonly<{ byField: FieldErrors; general: string | null }>;

export type InvalidField = Readonly<{ fieldId: string; label: string }>;

export const DRAFT_MESSAGES = {
  generic: "Nội dung này chưa hợp lệ, hãy kiểm tra lại.",
  invalidDate: "Ngày chưa hợp lệ.",
  serverGeneral: "Một số nội dung chưa hợp lệ với mẫu quà này.",
  unavailableTheme: "Giao diện này không còn khả dụng, hãy chọn lại.",
  unavailableTrack: "Bản nhạc này không còn khả dụng, hãy chọn lại.",
} as const;

export function tooManyImagesMessage(maxItems: number): string {
  return `Tối đa ${maxItems} ảnh.`;
}

type ManifestSchemas = Readonly<{
  draft: ReturnType<typeof createTemplateDraftPayloadSchema>;
  full: ReturnType<typeof createTemplatePayloadSchema>;
}>;

const schemaCache = new WeakMap<TemplateManifest, ManifestSchemas>();

/** Both payload schemas of a manifest, built once per manifest object. */
function schemasFor(manifest: TemplateManifest): ManifestSchemas {
  let schemas = schemaCache.get(manifest);
  if (!schemas) {
    schemas = {
      draft: createTemplateDraftPayloadSchema(manifest),
      full: createTemplatePayloadSchema(manifest),
    };
    schemaCache.set(manifest, schemas);
  }
  return schemas;
}

function findField(manifest: TemplateManifest, fieldId: string): TemplateField | undefined {
  return manifest.fields.find((field) => field.id === fieldId);
}

/**
 * The value to store for an edited field, or `undefined` to remove the field: whitespace-only
 * text, a cleared date, theme or track, and an empty image list are removed.
 */
export function normalizeFieldValue(field: TemplateField, raw: unknown): unknown {
  if (field.type === "imageList" || field.type === "captionedImageList") {
    return Array.isArray(raw) && raw.length > 0 ? raw : undefined;
  }
  return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
}

/** A copy of `content` with the field set to its normalized value, or removed. */
export function withFieldValue(
  manifest: TemplateManifest,
  content: DraftContent,
  fieldId: string,
  raw: unknown,
): DraftContent {
  const field = findField(manifest, fieldId);
  if (!field) return content;
  const value = normalizeFieldValue(field, raw);
  // An equal value keeps the same object, so the store notifies nobody and autosave stays idle.
  if (value === undefined ? !(fieldId in content) : isDeepEqual(content[fieldId], value)) {
    return content;
  }
  const next: Record<string, unknown> = { ...content };
  if (value === undefined) delete next[fieldId];
  else next[fieldId] = value;
  return next;
}

function messageFor(field: TemplateField, issue: { code: string; path: readonly PropertyKey[] }) {
  switch (field.type) {
    case "audio":
      return DRAFT_MESSAGES.unavailableTrack;
    case "theme":
      return DRAFT_MESSAGES.unavailableTheme;
    case "date":
      return DRAFT_MESSAGES.invalidDate;
    case "imageList":
    case "captionedImageList":
      return issue.code === "too_big" && issue.path.length === 1
        ? tooManyImagesMessage(field.maxItems)
        : DRAFT_MESSAGES.generic;
    default:
      return DRAFT_MESSAGES.generic;
  }
}

/**
 * Client-side errors of on-screen content under the draft rules the server applies, plus an
 * error for an `audio` value that is not a selectable catalog track. Issues that concern no
 * single field are left to the server.
 */
export function validateDraftContent(
  manifest: TemplateManifest,
  content: DraftContent,
  selectableTrackIds: ReadonlySet<string>,
): FieldErrors {
  const errors: Record<string, string> = {};
  const result = schemasFor(manifest).draft.safeParse(content);
  for (const issue of result.error?.issues ?? []) {
    const fieldId = issue.path[0];
    if (typeof fieldId !== "string" || fieldId in errors) continue;
    const field = findField(manifest, fieldId);
    if (field) errors[fieldId] = messageFor(field, issue);
  }

  for (const field of manifest.fields) {
    const value = content[field.id];
    if (
      field.type === "audio" &&
      value !== undefined &&
      !(field.id in errors) &&
      !(typeof value === "string" && selectableTrackIds.has(value))
    ) {
      errors[field.id] = DRAFT_MESSAGES.unavailableTrack;
    }
  }
  return errors;
}

/**
 * Completion per template step under the full payload rules: every required field has a value,
 * every value satisfies `minItems` and the other rules, and no field has a client-side error.
 * Studio-level steps are not included.
 */
export function stepCompletion(
  manifest: TemplateManifest,
  steps: readonly StudioStep[],
  content: DraftContent,
  errors: FieldErrors,
): Readonly<Record<string, boolean>> {
  const incomplete = new Set<string>(Object.keys(errors));
  const result = schemasFor(manifest).full.safeParse(content);
  for (const issue of result.error?.issues ?? []) {
    const fieldId = issue.path[0];
    if (typeof fieldId === "string") incomplete.add(fieldId);
  }

  const completion: Record<string, boolean> = {};
  for (const step of steps) {
    if (step.kind !== "template") continue;
    completion[step.id] = step.fieldIds.every((fieldId) => !incomplete.has(fieldId));
  }
  return completion;
}

/** The first field with an error, taking steps in navigation order and fields in step order. */
export function firstInvalidField(
  manifest: TemplateManifest,
  steps: readonly StudioStep[],
  errors: FieldErrors,
): InvalidField | null {
  for (const step of steps) {
    for (const fieldId of step.fieldIds) {
      if (fieldId in errors) {
        return { fieldId, label: findField(manifest, fieldId)?.label ?? fieldId };
      }
    }
  }
  return null;
}

/**
 * Maps server `fieldErrors` keys to fields by their first `.` segment. A key equal to a declared
 * field id always names that field; keys that name no field become one general message. Server
 * texts are never shown.
 */
export function mapServerFieldErrors(
  manifest: TemplateManifest,
  fieldErrors: Readonly<Record<string, string>>,
): MappedServerErrors {
  const byField: Record<string, string> = {};
  let general: string | null = null;
  for (const key of Object.keys(fieldErrors)) {
    const fieldId = findField(manifest, key) ? key : (key.split(".")[0] ?? "");
    if (findField(manifest, fieldId)) byField[fieldId] = DRAFT_MESSAGES.generic;
    else general = DRAFT_MESSAGES.serverGeneral;
  }
  return { byField, general };
}

/** `{n}/{maxLength}` in UTF-16 code units, like Zod `.max()` and the HTML `maxLength`. */
export function textCounter(value: string, maxLength: number): string {
  return `${value.length}/${maxLength}`;
}

/** Structural equality of plain JSON values (draft content). */
export function isDeepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((item, index) => isDeepEqual(item, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  return (
    leftKeys.length === Object.keys(rightRecord).length &&
    leftKeys.every(
      (key) => Object.hasOwn(rightRecord, key) && isDeepEqual(leftRecord[key], rightRecord[key]),
    )
  );
}
