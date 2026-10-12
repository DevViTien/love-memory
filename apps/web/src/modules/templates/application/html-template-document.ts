import { type DefaultTreeAdapterTypes, html as htmlSpec, parse } from "parse5";

import { scanCssUrls } from "./css-url-scan";

type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

/** The id of the JSON block that holds a template's default configuration. */
export const GIFT_CONFIG_ELEMENT_ID = "gift-config";
/** The bootstrap every `html` artifact loads first. */
export const LOVE_GIFT_BOOTSTRAP_FILE = "love-gift.js";
/** The inert placeholder of an extracted inline script; the bootstrap runs it after `INIT`. */
export const DEFERRED_SCRIPT_TYPE = "application/x-love-gift-script";

/** JavaScript MIME types of the HTML standard; an absent or empty `type` is JavaScript as well. */
const JAVASCRIPT_TYPES = new Set([
  "",
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

/** Elements that could load another document, submit, or change how URLs resolve. */
const FORBIDDEN_ELEMENTS = new Set([
  "applet",
  "base",
  "embed",
  "form",
  "frame",
  "frameset",
  "iframe",
  "link",
  "object",
  "portal",
]);

/** Attributes whose value is a URL the browser loads or navigates to. */
const URL_ATTRIBUTES = new Set([
  "action",
  "background",
  "cite",
  "data",
  "formaction",
  "href",
  "icon",
  "longdesc",
  "manifest",
  "ping",
  "poster",
  "src",
  "srcset",
]);

/** SVG animation elements (lowercased), which must not animate a link attribute. */
export const SVG_ANIMATION_ELEMENTS = new Set([
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
]);

/** Elements whose `href` navigates; they may only point at a fragment of the same document. */
const NAVIGATION_ELEMENTS = new Set(["a", "area"]);

/** The W3C namespace URIs that templates may spell out in scripts (`createElementNS`). */
const EXTERNAL_URL_IN_SCRIPT = /\bhttps?:\/\/(?!www\.w3\.org\/)/i;

export type HtmlScript = Readonly<{ fileName: string; source: string }>;

export type ParsedHtmlTemplate = Readonly<{
  /** The parsed `gift-config` JSON. */
  defaults: unknown;
  /** The entry document with the bootstrap first and every inline script deferred. */
  document: string;
  /** Problems that refuse the import; empty when the document is accepted. */
  problems: readonly string[];
  /** The extracted inline scripts in document order. */
  scripts: readonly HtmlScript[];
}>;

type UrlCheck = Readonly<{
  /** Relative file names the template ships, such as `assets/photo.jpg`. */
  files: ReadonlySet<string>;
  problems: string[];
}>;

/**
 * The relative artifact file a URL names, or why it is refused. Browsers drop ASCII whitespace and
 * control characters inside URLs, so they are removed before the scheme is read.
 */
export function classifyTemplateUrl(
  raw: string,
):
  | Readonly<{ kind: "data" | "empty" | "fragment" | "forbidden" | "root-relative" }>
  | Readonly<{ kind: "file"; name: string }> {
  const value = raw.replace(/[\u0000- ]/g, "");
  if (value === "") return { kind: "empty" };
  if (value.startsWith("#")) return { kind: "fragment" };
  if (value.startsWith("//") || value.startsWith("\\")) return { kind: "forbidden" };
  // `/assets/x.png` would name a route of the application, not a file of the template.
  if (value.startsWith("/")) return { kind: "root-relative" };
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (scheme) return scheme[1]?.toLowerCase() === "data" ? { kind: "data" } : { kind: "forbidden" };
  const path = value.split(/[?#]/)[0] ?? "";
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return { kind: "forbidden" };
    segments.push(segment);
  }
  return segments.length === 0 ? { kind: "forbidden" } : { kind: "file", name: segments.join("/") };
}

function checkResourceUrl(value: string, where: string, check: UrlCheck): void {
  const url = classifyTemplateUrl(value);
  if (url.kind === "forbidden") {
    check.problems.push(`${where}: only the template's own files, data: URLs and #fragments.`);
  } else if (url.kind === "root-relative") {
    check.problems.push(
      `${where}: ${value.trim()} starts with "/"; write it relative to index.html (assets/...).`,
    );
  } else if (url.kind === "file" && !check.files.has(url.name)) {
    check.problems.push(`${where}: ${url.name} is not a file of the template.`);
  }
}

/**
 * `@import` and CSS escapes (`\`, which could spell a URL or function in pieces) are refused;
 * every `url()` and every string of an `image-set()` must name a template file, a `data:` URL or
 * a fragment, and an unterminated `url(` or string is refused.
 */
export function checkTemplateCss(css: string, where: string, check: UrlCheck): void {
  if (/@import/i.test(css)) check.problems.push(`${where}: @import is not allowed.`);
  if (css.includes("\\")) check.problems.push(`${where}: CSS escapes (\\) are not allowed.`);
  const scan = scanCssUrls(css);
  if (scan.malformed) {
    check.problems.push(`${where}: a url() or image-set() is not properly closed.`);
  }
  for (const url of scan.urls) checkResourceUrl(url, `${where} url()`, check);
}

/**
 * The URLs of a `srcset`, as the HTML standard splits it: a URL is a run of non-whitespace (so
 * a `data:` URL keeps its comma), followed by descriptors up to the next comma.
 */
export function srcsetUrls(value: string): string[] {
  const urls: string[] = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /[\s,]/.test(value[index] ?? "")) index += 1;
    if (index >= value.length) break;
    let end = index;
    while (end < value.length && !/\s/.test(value[end] ?? "")) end += 1;
    let url = value.slice(index, end);
    index = end;
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      while (index < value.length && value[index] !== ",") index += 1;
    }
    urls.push(url);
  }
  return urls;
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((candidate) => candidate.name === name && !candidate.prefix)?.value;
}

function textOf(element: Element): string {
  return element.childNodes
    .map((child) => ("value" in child && child.nodeName === "#text" ? child.value : ""))
    .join("");
}

function childElements(node: ParentNode): Element[] {
  const children = node.childNodes.filter((child): child is Element => "tagName" in child);
  const template = node as Partial<DefaultTreeAdapterTypes.Template>;
  return template.content ? [...children, ...childElements(template.content)] : children;
}

function walk(node: ParentNode, visit: (element: Element) => void): void {
  for (const element of childElements(node)) {
    visit(element);
    walk(element, visit);
  }
}

function checkAttributes(element: Element, check: UrlCheck): void {
  const tag = element.tagName;
  for (const { name, value } of element.attrs) {
    const lower = name.toLowerCase();
    const where = `<${tag} ${lower}>`;
    // CSS in `style`, and in any value that names a `url(` or `image-set(` (SVG presentation
    // attributes such as `fill`, `filter`, `mask` or `clip-path`). It never replaces the checks
    // below: a URL attribute is still checked as a URL.
    if (lower === "style" || /url\(|image-set\(/i.test(value)) {
      checkTemplateCss(value, where, check);
    }
    if (lower.startsWith("on")) {
      check.problems.push(`${where}: inline event handlers are not allowed.`);
    } else if (lower === "srcdoc" || lower === "action" || lower === "formaction") {
      check.problems.push(`${where}: not allowed.`);
    } else if (
      lower === "attributename" &&
      SVG_ANIMATION_ELEMENTS.has(tag.toLowerCase()) &&
      /href/i.test(value)
    ) {
      check.problems.push(`${where}: animating a link is not allowed.`);
    } else if (lower === "srcset") {
      for (const url of srcsetUrls(value)) checkResourceUrl(url, where, check);
    } else if (lower === "href" && NAVIGATION_ELEMENTS.has(tag)) {
      if (classifyTemplateUrl(value).kind !== "fragment") {
        check.problems.push(`${where}: links may only point at a #fragment of the template.`);
      }
    } else if (URL_ATTRIBUTES.has(lower)) {
      checkResourceUrl(value, where, check);
    }
  }
}

/**
 * Checks and rewrites the entry document of an `html` template:
 *
 * - exactly one `<script type="application/json" id="gift-config">` holding the defaults;
 * - every inline script becomes `script-{n}.js`, replaced in place by an inert placeholder that the
 *   bootstrap runs after `INIT`;
 * - `<script src="love-gift.js">` is inserted first in `<head>`;
 * - refused: script `src`, module scripts, inline event handlers, `javascript:` and external URLs
 *   (also in CSS and scripts), `@import`, navigating links, `<link>`, `<iframe>`, `<object>`,
 *   `<embed>`, `<form>`, `<base>` and `<meta http-equiv>`.
 *
 * The rest of the document keeps its exact bytes.
 */
export function parseHtmlTemplate(html: string, files: ReadonlySet<string>): ParsedHtmlTemplate {
  const check: UrlCheck = { files, problems: [] };
  const document = parse(html, { sourceCodeLocationInfo: true });
  const replacements: { end: number; start: number; text: string }[] = [];
  const scripts: HtmlScript[] = [];
  const configs: string[] = [];
  let head: Element | undefined;

  walk(document, (element) => {
    const tag = element.tagName;
    if (tag === "head") head ??= element;
    if (FORBIDDEN_ELEMENTS.has(tag)) {
      check.problems.push(`<${tag}> is not allowed.`);
    }
    if (tag === "meta" && attribute(element, "http-equiv") !== undefined) {
      check.problems.push("<meta http-equiv> is not allowed.");
    }
    checkAttributes(element, check);
    if (tag === "style") checkTemplateCss(textOf(element), "<style>", check);
    if (tag !== "script") return;

    const type = (attribute(element, "type") ?? "").trim().toLowerCase();
    const source = textOf(element);
    if (element.namespaceURI !== htmlSpec.NS.HTML) {
      check.problems.push("Scripts inside SVG are not allowed.");
    } else if (attribute(element, "src") !== undefined) {
      check.problems.push("<script src> is not allowed: write scripts inline.");
    } else if (type === "module") {
      check.problems.push("Module scripts are not allowed: use classic inline scripts.");
    } else if (type === DEFERRED_SCRIPT_TYPE) {
      check.problems.push(`<script type="${DEFERRED_SCRIPT_TYPE}"> is reserved.`);
    } else if (attribute(element, "id") === GIFT_CONFIG_ELEMENT_ID) {
      if (type === "application/json") configs.push(source);
      else check.problems.push(`#${GIFT_CONFIG_ELEMENT_ID} must be type="application/json".`);
    } else if (JAVASCRIPT_TYPES.has(type)) {
      if (EXTERNAL_URL_IN_SCRIPT.test(source)) {
        check.problems.push("Scripts must not contain external URLs.");
      }
      const location = element.sourceCodeLocation;
      if (!location) {
        check.problems.push("A script could not be located in the document.");
        return;
      }
      const fileName = `script-${scripts.length + 1}.js`;
      scripts.push({ fileName, source });
      replacements.push({
        end: location.endOffset,
        start: location.startOffset,
        text: `<script type="${DEFERRED_SCRIPT_TYPE}" data-src="${fileName}"></script>`,
      });
    }
  });

  if (configs.length !== 1) {
    check.problems.push(
      `Expected exactly one <script type="application/json" id="${GIFT_CONFIG_ELEMENT_ID}">.`,
    );
  }
  let defaults: unknown = undefined;
  if (configs.length === 1) {
    try {
      defaults = JSON.parse(configs[0] ?? "") as unknown;
    } catch {
      check.problems.push(`#${GIFT_CONFIG_ELEMENT_ID} is not valid JSON.`);
    }
  }

  const headStart = head?.sourceCodeLocation?.startTag?.endOffset;
  if (headStart === undefined) {
    check.problems.push("The document needs an explicit <head> element.");
  } else {
    replacements.push({
      end: headStart,
      start: headStart,
      text: `\n<script src="${LOVE_GIFT_BOOTSTRAP_FILE}"></script>`,
    });
  }

  let output = html;
  for (const { end, start, text } of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, start) + text + output.slice(end);
  }
  return { defaults, document: output, problems: check.problems, scripts };
}
