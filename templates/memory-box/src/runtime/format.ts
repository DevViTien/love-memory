/**
 * Trims an untrusted value and bounds it to `maxLength` UTF-16 code units without splitting a
 * surrogate pair. Returns `undefined` for anything that is not a non-empty string.
 */
export function boundText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length <= maxLength) return trimmed;

  const lastCode = trimmed.charCodeAt(maxLength - 1);
  const end = lastCode >= 0xd800 && lastCode <= 0xdbff ? maxLength - 1 : maxLength;
  return trimmed.slice(0, end).trimEnd();
}

function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

/**
 * Formats an ISO calendar date (`YYYY-MM-DD`) as `DD/MM/YYYY`. It never builds a `Date`, so the
 * recipient's time zone cannot shift the day. Invalid dates return `undefined`.
 */
export function formatCalendarDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;

  const [, year = "", month = "", day = ""] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12) return undefined;
  if (dayNumber < 1 || dayNumber > daysInMonth(Number(year), monthNumber)) return undefined;
  return `${day}/${month}/${year}`;
}

/** Splits letter text into paragraphs at blank lines; single line breaks stay in a paragraph. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\r?\n[ \t]*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}
