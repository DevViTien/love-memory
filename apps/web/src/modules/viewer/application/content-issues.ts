import { type LicensedAudioTrackDto } from "@love-memory/contracts";
import { type MediaAsset, type MediaAssetDerivative } from "@love-memory/domain";
import {
  createTemplatePayloadSchema,
  isImageField,
  listImageFieldReferences,
  type TemplateManifest,
} from "@love-memory/template-sdk";

import { orderIssues, type ViewerField, type ViewerIssue } from "./viewer-payload";

/** The derivative width a gift viewer shows: large enough for a phone, small enough to load fast. */
export const VIEWER_ASSET_TARGET_WIDTH = 768;

export type ContentIssuesInput = Readonly<{
  /** Every asset record of the gift; only `ready` assets of the referencing field count. */
  assets: readonly MediaAsset[];
  content: Readonly<Record<string, unknown>>;
  giftId: string;
  manifest: TemplateManifest;
}>;

export type ContentIssuesDependencies = Readonly<{
  findSelectableTrack: (id: string) => LicensedAudioTrackDto | null;
}>;

/** An image reference that a viewer can show: the asset and the derivative to sign. */
export type AvailableImageReference = Readonly<{ assetId: string; key: string }>;

/** The smallest derivative at least 768 px wide, or the widest one when none reaches 768 px. */
export function selectViewerDerivative(
  derivatives: readonly MediaAssetDerivative[],
): MediaAssetDerivative | null {
  let best: MediaAssetDerivative | null = null;
  for (const derivative of derivatives) {
    if (!best) {
      best = derivative;
      continue;
    }
    const bestReaches = best.width >= VIEWER_ASSET_TARGET_WIDTH;
    const reaches = derivative.width >= VIEWER_ASSET_TARGET_WIDTH;
    if (reaches && (!bestReaches || derivative.width < best.width)) best = derivative;
    else if (!reaches && !bestReaches && derivative.width > best.width) best = derivative;
  }
  return best;
}

/** What a host needs to render content statically and to label issues; never gift content. */
export function toViewerFields(manifest: TemplateManifest): ViewerField[] {
  return manifest.fields.map((field) => ({
    id: field.id,
    label: field.label,
    required: field.required,
    type: field.type,
    ...(isImageField(field) ? { maxItems: field.maxItems, minItems: field.minItems } : {}),
  }));
}

function schemaIssues(
  manifest: TemplateManifest,
  content: Readonly<Record<string, unknown>>,
): ViewerIssue[] {
  const result = createTemplatePayloadSchema(manifest).safeParse(content);
  if (result.success) return [];

  const fieldIds = new Set(manifest.fields.map((field) => field.id));
  const mapped = result.error.issues.flatMap((issue): ViewerIssue[] => {
    const [fieldId, item] = issue.path;
    // Unknown keys (an empty path) name no field; the draft schema already rejects them on save.
    if (typeof fieldId !== "string") return [];
    if (content[fieldId] === undefined) return [{ code: "CONTENT_MISSING", fieldId }];
    if (
      issue.path.length === 1 &&
      issue.code === "too_small" &&
      "origin" in issue &&
      issue.origin === "array"
    ) {
      return [{ code: "CONTENT_TOO_FEW", fieldId }];
    }
    return [
      typeof item === "number"
        ? { code: "CONTENT_INVALID", fieldId, itemIndex: item }
        : { code: "CONTENT_INVALID", fieldId },
    ];
  });
  // Fail closed: a failure that names no declared field (an undeclared key, a non-object value)
  // is still invalid content, attributed to the first field so publish can never pass it.
  const firstField = manifest.fields[0];
  if (!mapped.some((issue) => fieldIds.has(issue.fieldId)) && firstField) {
    mapped.push({ code: "CONTENT_INVALID", fieldId: firstField.id });
  }
  return mapped;
}

/**
 * Splits the stored image references into those a viewer can show and `ASSET_UNAVAILABLE` issues.
 * Stored content is untrusted: only this gift's `ready` asset of the very field that references it,
 * with a derivative, is available.
 */
export function resolveImageReferences(input: ContentIssuesInput): Readonly<{
  available: readonly AvailableImageReference[];
  unavailable: readonly ViewerIssue[];
}> {
  const assetsById = new Map(
    input.assets
      .filter((asset) => asset.giftId === input.giftId && asset.status === "ready")
      .map((asset) => [asset.id, asset]),
  );
  const available: AvailableImageReference[] = [];
  const unavailable: ViewerIssue[] = [];
  for (const { assetIds, fieldId } of listImageFieldReferences(input.manifest, input.content)) {
    assetIds.forEach((assetId, itemIndex) => {
      const asset = typeof assetId === "string" ? assetsById.get(assetId) : undefined;
      const derivative =
        asset && asset.fieldId === fieldId ? selectViewerDerivative(asset.derivatives) : null;
      if (derivative) available.push({ assetId, key: derivative.key });
      else unavailable.push({ code: "ASSET_UNAVAILABLE", fieldId, itemIndex });
    });
  }
  return { available, unavailable };
}

/**
 * The server-side content issues of a gift: the full (non-draft) payload rules, unavailable images
 * and a withdrawn audio track, ordered by field. Preview lists them; publish requires none. It
 * signs nothing and never logs.
 */
export function collectContentIssues(
  input: ContentIssuesInput,
  dependencies: ContentIssuesDependencies,
): ViewerIssue[] {
  const { content, manifest } = input;
  const issues: ViewerIssue[] = schemaIssues(manifest, content);

  const audioField = manifest.fields.find((field) => field.type === "audio");
  const audioValue = audioField ? content[audioField.id] : undefined;
  const track =
    typeof audioValue === "string" ? dependencies.findSelectableTrack(audioValue) : null;
  if (audioField && audioValue !== undefined && !track) {
    issues.push({ code: "CONTENT_INVALID", fieldId: audioField.id });
  }

  return orderIssues(
    manifest.fields.map((field) => field.id),
    [...issues, ...resolveImageReferences(input).unavailable],
  );
}

function issueMessage(issue: ViewerIssue, fields: readonly ViewerField[]): string {
  switch (issue.code) {
    case "CONTENT_MISSING":
      return "This field is required.";
    case "CONTENT_TOO_FEW": {
      const minItems = fields.find((field) => field.id === issue.fieldId)?.minItems ?? 1;
      return `Add at least ${minItems} images.`;
    }
    case "ASSET_UNAVAILABLE":
      return "This image is not ready.";
    case "CONTENT_INVALID":
      return "This value is not valid.";
  }
}

/**
 * One API field error per issue, keyed `fieldId` or `fieldId.itemIndex`. The first issue of a key
 * wins. Messages are fixed English strings chosen by code; they never contain gift text.
 */
export function issuesToFieldErrors(
  issues: readonly ViewerIssue[],
  fields: readonly ViewerField[],
): Readonly<Record<string, string>> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key =
      issue.itemIndex === undefined ? issue.fieldId : `${issue.fieldId}.${issue.itemIndex}`;
    fieldErrors[key] ??= issueMessage(issue, fields);
  }
  return fieldErrors;
}
