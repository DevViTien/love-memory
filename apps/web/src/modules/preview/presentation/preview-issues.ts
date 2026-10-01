import {
  issueKey,
  orderIssues,
  type ViewerField,
  type ViewerIssue,
} from "@/modules/viewer/application/viewer-payload";

export const UNKNOWN_FIELD_ISSUE_MESSAGE = "Mẫu quà báo một nội dung chưa hiển thị được.";

export type PreviewIssueItem = Readonly<{
  /** `/studio/{publicId}?field={fieldId}` when this browser can edit the draft, else `null`. */
  href: string | null;
  key: string;
  message: string;
}>;

/** The creator-facing message of one issue; it names the field by label, never gift text. */
export function describeIssue(field: ViewerField, issue: ViewerIssue): string {
  const item = issue.itemIndex === undefined ? null : issue.itemIndex + 1;
  switch (issue.code) {
    case "CONTENT_MISSING":
      return `${field.label}: chưa có nội dung.`;
    case "CONTENT_TOO_FEW":
      return `${field.label}: cần ít nhất ${field.minItems ?? 1} ảnh.`;
    case "CONTENT_INVALID":
      return item === null
        ? `${field.label}: nội dung chưa hợp lệ.`
        : `${field.label}: mục ${item} chưa hợp lệ.`;
    case "ASSET_UNAVAILABLE":
      return item === null
        ? `${field.label}: ảnh chưa sẵn sàng hoặc không tải được.`
        : `${field.label}: ảnh ${item} chưa sẵn sàng hoặc không tải được.`;
  }
}

/**
 * Merges the payload's issues with the template's distinct `ISSUE` events: one entry per
 * (`code`, `fieldId`, `itemIndex`), in field order, then `itemIndex`. Issues naming no manifest
 * field become one unlinked entry at the end.
 */
export function mergePreviewIssues(
  fields: readonly ViewerField[],
  serverIssues: readonly ViewerIssue[],
  templateIssues: readonly ViewerIssue[],
  options: Readonly<{ canEdit: boolean; publicId: string }>,
): PreviewIssueItem[] {
  const all = [...serverIssues, ...templateIssues];
  const fieldIds = fields.map((field) => field.id);
  const items = orderIssues(fieldIds, all).map((issue): PreviewIssueItem => {
    const field = fields.find((candidate) => candidate.id === issue.fieldId)!;
    return {
      href: options.canEdit
        ? `/studio/${encodeURIComponent(options.publicId)}?field=${encodeURIComponent(field.id)}`
        : null,
      key: issueKey(issue),
      message: describeIssue(field, issue),
    };
  });
  if (all.some((issue) => !fieldIds.includes(issue.fieldId))) {
    items.push({ href: null, key: "unknown-field", message: UNKNOWN_FIELD_ISSUE_MESSAGE });
  }
  return items;
}
