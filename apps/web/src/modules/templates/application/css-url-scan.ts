/** The URLs a piece of CSS names, and whether a `url(` or `image-set(` is not properly closed. */
export type CssUrlScan = Readonly<{ malformed: boolean; urls: readonly string[] }>;

/** The end of a quoted string starting at `start` (its quote), or `-1` when it never closes. */
function stringEnd(css: string, start: number): number {
  const quote = css[start];
  const end = css.indexOf(quote ?? "", start + 1);
  const newline = css.slice(start + 1, end === -1 ? undefined : end).search(/[\n\r\f]/);
  return end === -1 || newline !== -1 ? -1 : end;
}

/** `url(...)` at `start` (just after `url(`): its URL and the index after `)`, or `null`. */
function readUrl(css: string, start: number): Readonly<{ end: number; url: string }> | null {
  let index = start;
  while (/\s/.test(css[index] ?? "")) index += 1;
  let url: string;
  if (css[index] === '"' || css[index] === "'") {
    const end = stringEnd(css, index);
    if (end === -1) return null;
    url = css.slice(index + 1, end);
    index = end + 1;
    while (/\s/.test(css[index] ?? "")) index += 1;
  } else {
    const close = css.indexOf(")", index);
    if (close === -1) return null;
    url = css.slice(index, close).trim();
    if (/["'(\s]/.test(url)) return null;
    index = close;
  }
  return css[index] === ")" ? { end: index + 1, url } : null;
}

/** `image-set(...)` at `start`: its quoted strings, or `null` when a string or it never closes. */
function readImageSet(css: string, start: number): readonly string[] | null {
  const strings: string[] = [];
  let depth = 1;
  let index = start;
  while (index < css.length) {
    const character = css[index];
    if (character === '"' || character === "'") {
      const end = stringEnd(css, index);
      if (end === -1) return null;
      strings.push(css.slice(index + 1, end));
      index = end + 1;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0) return strings;
    index += 1;
  }
  return null;
}

/**
 * Every `url()` and every string of an `image-set()` (also `-webkit-image-set()`) in a piece of
 * CSS, read the way CSS reads them. A `url(` or string that never closes makes the CSS malformed:
 * the importer then refuses it rather than guess what a browser would load.
 */
export function scanCssUrls(css: string): CssUrlScan {
  const urls: string[] = [];
  let malformed = false;
  for (const match of css.matchAll(/url\(|image-set\(/gi)) {
    const start = (match.index ?? 0) + match[0].length;
    if (match[0].toLowerCase() === "url(") {
      const url = readUrl(css, start);
      if (url) urls.push(url.url);
      else malformed = true;
    } else {
      const strings = readImageSet(css, start);
      if (strings) urls.push(...strings);
      else malformed = true;
    }
  }
  return { malformed, urls };
}
