import { scanCssUrls } from "./css-url-scan";
import { classifyTemplateUrl, SVG_ANIMATION_ELEMENTS } from "./html-template-document";

/** Elements an SVG image must not hold, by local name (any namespace prefix). */
const FORBIDDEN_SVG_ELEMENTS = new Set([
  "embed",
  "foreignobject",
  "handler",
  "iframe",
  "listener",
  "object",
  "script",
]);

/** The only character references allowed: anything else could spell a name or URL in pieces. */
const UNSAFE_REFERENCE = /&(?!(?:amp|lt|gt|quot|apos);)/;

const NAME = String.raw`[A-Za-z_][\w.:-]*`;
const ATTRIBUTE = String.raw`\s+(${NAME})(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?`;
const START_TAG = new RegExp(
  String.raw`<(${NAME})((?:\s+${NAME}(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(/?)>`,
  "y",
);
const END_TAG = new RegExp(String.raw`</(${NAME})\s*>`, "y");

function localName(name: string): string {
  return (name.slice(name.lastIndexOf(":") + 1) || name).toLowerCase();
}

function checkStyle(css: string, problems: string[]): void {
  if (/@import/i.test(css) || /\\/.test(css)) {
    problems.push("@import and CSS escapes are not allowed.");
  }
  const scan = scanCssUrls(css);
  if (scan.malformed) problems.push("A url() or image-set() is not properly closed.");
  for (const url of scan.urls) {
    const kind = classifyTemplateUrl(url).kind;
    if (kind !== "fragment" && kind !== "data") problems.push("url() may only name a #fragment.");
  }
}

/**
 * The problems of an SVG asset, which the template may show only as an image. It is tokenized
 * strictly: comments and an XML declaration are skipped, any other markup that is not a
 * well-formed tag (doctype, entity, CDATA, processing instruction) is refused. Elements and
 * attributes are judged by their local name, so a namespace prefix (`<s:script>`) changes nothing.
 */
export function svgAssetProblems(svg: string): string[] {
  const problems: string[] = [];
  let index = 0;
  let root: string | null = null;
  let insideStyle = false;
  let styleStart = 0;

  while (index < svg.length) {
    const open = svg.indexOf("<", index);
    if (open === -1) break;
    if (svg.startsWith("<!--", open)) {
      const close = svg.indexOf("-->", open + 4);
      if (close === -1) return ["The SVG has an unterminated comment."];
      index = close + 3;
      continue;
    }
    if (open === svg.search(/\S/) && /^<\?xml\s[^?]*\?>/.test(svg.slice(open))) {
      index = svg.indexOf("?>", open) + 2;
      continue;
    }
    END_TAG.lastIndex = open;
    const end = END_TAG.exec(svg);
    if (end) {
      if (insideStyle && localName(end[1] ?? "") === "style") {
        checkStyle(svg.slice(styleStart, open), problems);
        insideStyle = false;
      }
      index = END_TAG.lastIndex;
      continue;
    }
    START_TAG.lastIndex = open;
    const start = START_TAG.exec(svg);
    if (!start) return ["The SVG must be well-formed markup without doctype, entities or CDATA."];
    index = START_TAG.lastIndex;
    const element = localName(start[1] ?? "");
    root ??= element;
    if (FORBIDDEN_SVG_ELEMENTS.has(element)) problems.push(`<${element}> is not allowed.`);
    if (element === "style" && start[3] !== "/") {
      insideStyle = true;
      styleStart = index;
    }
    for (const attribute of (start[2] ?? "").matchAll(new RegExp(ATTRIBUTE, "g"))) {
      const name = localName(attribute[1] ?? "");
      const value = attribute[2] ?? attribute[3] ?? "";
      if (name.startsWith("on")) problems.push("Event handler attributes are not allowed.");
      // `style`, and presentation attributes such as `fill`, `filter` or `clip-path`.
      if (name === "style" || /url\(|image-set\(/i.test(value)) checkStyle(value, problems);
      if (name === "href" || name === "src") {
        const kind = classifyTemplateUrl(value).kind;
        if (kind !== "fragment" && kind !== "data" && kind !== "empty") {
          problems.push("Links may only name a #fragment or a data: URL.");
        }
      }
      if (SVG_ANIMATION_ELEMENTS.has(element) && name === "attributename" && /href/i.test(value)) {
        problems.push("Animating a link is not allowed.");
      }
    }
  }
  if (root !== "svg") problems.push("The file is not an SVG image.");
  if (UNSAFE_REFERENCE.test(svg)) {
    problems.push("Character references other than &amp; &lt; &gt; &quot; &apos; are not allowed.");
  }
  if (/javascript:|https?:\/\/(?!www\.w3\.org\/)/i.test(svg.replace(/xmlns(:\w+)?="[^"]*"/g, ""))) {
    problems.push("External and javascript: URLs are not allowed.");
  }
  return [...new Set(problems)];
}
