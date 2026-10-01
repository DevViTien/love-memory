import { type ViewerField, type ViewerPayload } from "../application/viewer-payload";

export type StaticImageItem = Readonly<{
  assetId: string;
  caption?: string;
  /** Shown when there is no URL or the image fails: the caption, or `Ảnh {n}`. */
  fallbackText: string;
  index: number;
  url?: string;
}>;

/** Plain data only: the component renders every string as a React text node, never as HTML. */
export type StaticGiftBlock =
  | Readonly<{ fieldId: string; items: readonly StaticImageItem[]; kind: "images" }>
  | Readonly<{ fieldId: string; kind: "text"; multiline: boolean; text: string }>;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `DD/MM/YYYY` from a calendar date, without any time-zone conversion. */
export function formatCalendarDate(value: string): string | null {
  const match = ISO_DATE.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function imageItems(
  field: ViewerField,
  value: unknown,
  assets: ViewerPayload["assets"],
): StaticImageItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown, index): StaticImageItem[] => {
    let assetId: string | null = null;
    let caption: string | null = null;
    if (field.type === "imageList") {
      assetId = nonEmpty(entry);
    } else if (typeof entry === "object" && entry !== null) {
      const item = entry as Readonly<Record<string, unknown>>;
      assetId = nonEmpty(item["assetId"]);
      caption = nonEmpty(item["caption"]);
    }
    if (!assetId) return [];
    const url = Object.hasOwn(assets, assetId) ? assets[assetId] : undefined;
    return [
      {
        assetId,
        fallbackText: caption ?? `Ảnh ${index + 1}`,
        index,
        ...(caption ? { caption } : {}),
        ...(url ? { url } : {}),
      },
    ];
  });
}

/**
 * The static rendering of a gift: every field with a value, in declaration order, without labels.
 * `theme` and `audio` are not content to read, and wrong-typed values are skipped.
 */
export function toStaticGiftBlocks(
  fields: readonly ViewerField[],
  payload: ViewerPayload["payload"],
  assets: ViewerPayload["assets"],
): StaticGiftBlock[] {
  return fields.flatMap((field): StaticGiftBlock[] => {
    const value = payload[field.id];
    switch (field.type) {
      case "shortText":
      case "longText": {
        const text = nonEmpty(value);
        return text
          ? [{ fieldId: field.id, kind: "text", multiline: field.type === "longText", text }]
          : [];
      }
      case "date": {
        const text = typeof value === "string" ? formatCalendarDate(value) : null;
        return text ? [{ fieldId: field.id, kind: "text", multiline: false, text }] : [];
      }
      case "imageList":
      case "captionedImageList": {
        const items = imageItems(field, value, assets);
        return items.length > 0 ? [{ fieldId: field.id, items, kind: "images" }] : [];
      }
      case "theme":
      case "audio":
        return [];
    }
  });
}
