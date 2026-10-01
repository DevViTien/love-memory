import type { TemplateIssueEvent } from "@love-memory/template-sdk";

import { boundText, formatCalendarDate } from "./format";
import { resolveThemeId, type ThemeId } from "./theme";

/** Field limits of the `memory-box` 1.1.0 manifest. */
export const MEMORY_BOX_LIMITS = Object.freeze({
  caption: 140,
  finalLetter: 1200,
  memories: 8,
  openingMessage: 120,
  receiverName: 40,
});

export type ContentIssue = Pick<TemplateIssueEvent, "code" | "fieldId" | "itemIndex">;

export type MemoryItem = Readonly<{
  caption?: string;
  /** Zero-based position in the `memories` field, used as `ISSUE` `itemIndex`. */
  index: number;
  /** `Kỷ niệm {n}`: alternative text and text-card fallback when there is no caption. */
  label: string;
  url?: string;
}>;

export type MemoryBoxContent = Readonly<{
  date?: string;
  finalLetter?: string;
  memories: readonly MemoryItem[];
  openingMessage?: string;
  receiverName?: string;
  theme: ThemeId;
}>;

export type NormalizedInit = Readonly<{ content: MemoryBoxContent; issues: ContentIssue[] }>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readUrl(assets: Readonly<Record<string, string>>, assetId: unknown): string | undefined {
  if (typeof assetId !== "string" || !Object.hasOwn(assets, assetId)) return undefined;
  const url = assets[assetId];
  return typeof url === "string" && url.length > 0 ? url : undefined;
}

function normalizeMemories(
  value: unknown,
  assets: Readonly<Record<string, string>>,
  issues: ContentIssue[],
): MemoryItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ code: "CONTENT_MISSING", fieldId: "memories" });
    return [];
  }

  return value.slice(0, MEMORY_BOX_LIMITS.memories).map((item: unknown, index) => {
    const caption = isRecord(item)
      ? boundText(item["caption"], MEMORY_BOX_LIMITS.caption)
      : undefined;
    const url = isRecord(item) ? readUrl(assets, item["assetId"]) : undefined;
    if (url === undefined) {
      issues.push({ code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: index });
    }
    return {
      ...(caption === undefined ? {} : { caption }),
      index,
      label: `Kỷ niệm ${index + 1}`,
      ...(url === undefined ? {} : { url }),
    };
  });
}

/**
 * Turns the untrusted `INIT` payload into normalized content and the content issues to report, in
 * field order. It never throws on malformed values; optional values that are invalid are omitted.
 */
export function normalizeInit(
  payload: Readonly<Record<string, unknown>>,
  assets: Readonly<Record<string, string>>,
): NormalizedInit {
  const issues: ContentIssue[] = [];
  const required = (fieldId: string, maxLength: number) => {
    const text = boundText(payload[fieldId], maxLength);
    if (text === undefined) issues.push({ code: "CONTENT_MISSING", fieldId });
    return text;
  };

  const receiverName = required("receiver-name", MEMORY_BOX_LIMITS.receiverName);
  const date = formatCalendarDate(payload["anniversary-date"]);
  const openingMessage = required("opening-message", MEMORY_BOX_LIMITS.openingMessage);
  const memories = normalizeMemories(payload["memories"], assets, issues);
  const finalLetter = required("final-letter", MEMORY_BOX_LIMITS.finalLetter);

  return {
    content: {
      ...(date === undefined ? {} : { date }),
      ...(finalLetter === undefined ? {} : { finalLetter }),
      memories,
      ...(openingMessage === undefined ? {} : { openingMessage }),
      ...(receiverName === undefined ? {} : { receiverName }),
      theme: resolveThemeId(payload["theme"]),
    },
    issues,
  };
}

export function issueKey(issue: ContentIssue): string {
  return `${issue.code}|${issue.fieldId}|${issue.itemIndex ?? ""}`;
}
