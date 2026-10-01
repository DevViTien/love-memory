import { type TemplateField } from "@love-memory/template-sdk";

/**
 * The input of every gift viewer, built by `buildViewerPayload` on the server. Preview and the
 * published Viewer use the same shape, so what a creator previews is what a recipient sees.
 * `GET /api/public-gifts/{shareId}` sends it to the browser, where `ViewerPayloadDtoSchema`
 * validates it; a type-equality test keeps the contract and these types aligned.
 */

export type ViewerIssueCode =
  "ASSET_UNAVAILABLE" | "CONTENT_INVALID" | "CONTENT_MISSING" | "CONTENT_TOO_FEW";

/** Creator feedback. It names a field and an item, never gift text. */
export type ViewerIssue = Readonly<{
  code: ViewerIssueCode;
  fieldId: string;
  itemIndex?: number;
}>;

/** What a host needs to render content statically and to label issues; never gift content. */
export type ViewerField = Readonly<{
  id: string;
  label: string;
  maxItems?: number;
  minItems?: number;
  required: boolean;
  type: TemplateField["type"];
}>;

export type ViewerPayload = Readonly<{
  /** The content-addressed artifact entry of the exact bound version, or `null` (static only). */
  artifactUrl: string | null;
  /** Asset id → short-lived signed URL, for `ready` assets of this gift and field only. */
  assets: Readonly<Record<string, string>>;
  /** ISO time at which the earliest URL in `assets` expires; `null` when `assets` is empty. */
  assetsExpireAt: string | null;
  audioUrl: string | null;
  fields: readonly ViewerField[];
  /** Creator feedback; a recipient response may omit it and a gift viewer never reads it. */
  issues?: readonly ViewerIssue[];
  /** The stored content, unchanged. */
  payload: Readonly<Record<string, unknown>>;
}>;

/** Where a gift viewer gets its payload: at mount (preview) or only on tap (published gift). */
export type ViewerSource =
  | Readonly<{ kind: "deferred"; load: () => Promise<ViewerPayload> }>
  | Readonly<{ kind: "ready"; viewer: ViewerPayload }>;

export type ViewerFallbackReason = "ERROR" | "INIT_TIMEOUT" | "LOAD_TIMEOUT" | "NO_ARTIFACT";

/** Lifecycle notifications for the host page. They never carry gift content. */
export type ViewerLifecycleEvent =
  | Readonly<{ reason: ViewerFallbackReason; type: "fallback" }>
  | Readonly<{ sceneId: string; type: "scene" }>
  | Readonly<{ type: "completed" }>
  | Readonly<{ type: "opened" }>;

/** The identity of an issue: `code|fieldId|itemIndex`. */
export function issueKey(issue: Readonly<{ code: string; fieldId: string; itemIndex?: number }>) {
  return `${issue.code}|${issue.fieldId}|${issue.itemIndex ?? ""}`;
}

/**
 * Distinct issues ordered by field declaration order, then `itemIndex`. Issues of fields that are
 * not in `fieldIds` are dropped.
 */
export function orderIssues<T extends ViewerIssue>(
  fieldIds: readonly string[],
  issues: readonly T[],
): T[] {
  const seen = new Set<string>();
  const distinct = issues.filter((issue) => {
    const key = issueKey(issue);
    if (seen.has(key) || !fieldIds.includes(issue.fieldId)) return false;
    seen.add(key);
    return true;
  });
  return distinct.sort(
    (left, right) =>
      fieldIds.indexOf(left.fieldId) - fieldIds.indexOf(right.fieldId) ||
      (left.itemIndex ?? -1) - (right.itemIndex ?? -1),
  );
}
