import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import {
  findTemplateBudgetViolations,
  HTML_TEMPLATE_ENTRY,
  TEMPLATE_ENGINE_VERSION,
  TemplateManifestSchema,
  type TemplateBuildMetrics,
  type TemplateField,
  type TemplateManifest,
} from "@love-memory/template-sdk";

import { svgAssetProblems } from "./svg-asset-check";
import {
  classifyTemplateUrl,
  LOVE_GIFT_BOOTSTRAP_FILE,
  parseHtmlTemplate,
} from "./html-template-document";

/** Limits of an `html` template's source folder. */
export const HTML_TEMPLATE_LIMITS = {
  maximumAssetBytes: 2 * 1024 * 1024,
  maximumAssets: 60,
  maximumDocumentBytes: 512 * 1024,
  maximumTotalBytes: 8 * 1024 * 1024,
} as const;

/** The marker in the bootstrap source that the importer replaces with the field mapping. */
export const BOOTSTRAP_FIELDS_MARKER = "/* love-gift:fields */ []";

/** Served content types by extension; anything else is refused. SVG is served as an image. */
const ASSET_CONTENT_TYPES: Readonly<Record<string, string>> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  woff2: "font/woff2",
};

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const JAVASCRIPT_CONTENT_TYPE = "text/javascript; charset=utf-8";
/** One path segment of a served file: the object key rules of `@love-memory/storage`. */
const FILE_SEGMENT = /^(?:[A-Za-z0-9_-]|[A-Za-z0-9_-][A-Za-z0-9._-]{0,126}[A-Za-z0-9_-])$/;

export type HtmlTemplateAsset = Readonly<{ bytes: Uint8Array; name: string }>;

/** A template folder as read from disk: the importer never touches the filesystem itself. */
export type HtmlTemplateSource = Readonly<{
  /** Files under `assets/`, named relative to the folder (`assets/photo.jpg`). */
  assets: readonly HtmlTemplateAsset[];
  /** The bootstrap source, with `BOOTSTRAP_FIELDS_MARKER` where the field mapping goes. */
  bootstrap: string;
  indexHtml: string;
  /** The parsed `template.json`. */
  manifest: unknown;
}>;

export type HtmlTemplateFile = Readonly<{
  body: Uint8Array;
  contentType: string;
  name: string;
  sha256: string;
  sizeBytes: number;
}>;

export type PreparedHtmlTemplate = Readonly<{
  /** SHA-256 over the sorted `name\0sha256` lines of every served file. */
  artifactContentHash: string;
  defaults: Readonly<Record<string, unknown>>;
  files: readonly HtmlTemplateFile[];
  manifest: TemplateManifest;
  metrics: TemplateBuildMetrics;
  /** The manifest to store: `template.json` with `engineVersion`, `entry` and `previewFixture`. */
  storedManifest: Readonly<Record<string, unknown>>;
}>;

/** A refused import, with every problem found. Messages name files and paths, never secrets. */
export class HtmlTemplateImportError extends Error {
  override readonly name = "HtmlTemplateImportError";

  constructor(readonly problems: readonly string[]) {
    super(
      `The template cannot be imported:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
    );
  }
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** SHA-256 over `name\0sha256` lines sorted by name: the artifact's content address. */
export function computeArtifactContentHash(
  files: readonly Readonly<{ name: string; sha256: string }>[],
): string {
  const lines = files
    .map(({ name, sha256 }) => `${name}\0${sha256}`)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return sha256Hex(lines.join("\n"));
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** A cheap signature check, so a renamed file is not served under a wrong content type. */
function hasExpectedSignature(extension: string, bytes: Uint8Array): boolean {
  switch (extension) {
    case "png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
    case "jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "webp":
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case "woff2":
      return startsWith(bytes, [0x77, 0x4f, 0x46, 0x32]);
    default:
      return true;
  }
}

/** The artifact route serves file paths of at most this many segments. */
const MAXIMUM_FILE_SEGMENTS = 6;

function checkAssets(assets: readonly HtmlTemplateAsset[], problems: string[]): void {
  if (assets.length > HTML_TEMPLATE_LIMITS.maximumAssets) {
    problems.push(`At most ${HTML_TEMPLATE_LIMITS.maximumAssets} asset files are allowed.`);
  }
  for (const { bytes, name } of assets) {
    const segments = name.split("/");
    if (segments[0] !== "assets" || !segments.every((segment) => FILE_SEGMENT.test(segment))) {
      problems.push(`${name}: asset names use A-Z, a-z, 0-9, ".", "_" and "-" under assets/.`);
      continue;
    }
    if (segments.length > MAXIMUM_FILE_SEGMENTS) {
      problems.push(`${name}: an asset path has at most ${MAXIMUM_FILE_SEGMENTS} segments.`);
      continue;
    }
    const extension = extensionOf(name);
    if (!ASSET_CONTENT_TYPES[extension]) {
      problems.push(`${name}: only woff2, png, jpg, jpeg, webp and svg assets are allowed.`);
      continue;
    }
    if (bytes.byteLength > HTML_TEMPLATE_LIMITS.maximumAssetBytes) {
      problems.push(`${name}: an asset must be at most 2 MB.`);
    }
    if (!hasExpectedSignature(extension, bytes)) {
      problems.push(`${name}: the file content does not match its extension.`);
    }
    if (extension === "svg") {
      for (const problem of svgAssetProblems(new TextDecoder().decode(bytes))) {
        problems.push(`${name}: ${problem}`);
      }
    }
  }
}

function completeManifest(input: unknown, problems: string[]): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    problems.push("template.json must be a JSON object.");
    return null;
  }
  const manifest = { ...(input as Record<string, unknown>) };
  if (manifest["kind"] !== "html") problems.push('template.json must declare "kind": "html".');
  manifest["engineVersion"] ??= TEMPLATE_ENGINE_VERSION;
  manifest["entry"] ??= HTML_TEMPLATE_ENTRY;
  // The preview content of an html template is the gift-config block of its entry document.
  manifest["previewFixture"] ??= HTML_TEMPLATE_ENTRY;
  return manifest;
}

/** The JSON type a field's default must have at its path. */
function expectedDefault(field: TemplateField): "objects" | "string" | "strings" | null {
  switch (field.type) {
    case "audio":
      return null;
    case "textList":
    case "imageList":
      return "strings";
    case "captionedImageList":
      return "objects";
    default:
      return "string";
  }
}

function readPath(value: unknown, path: string): Readonly<{ found: boolean; value: unknown }> {
  let node: unknown = value;
  for (const segment of path.split(".")) {
    if (typeof node !== "object" || node === null || Array.isArray(node)) {
      return { found: false, value: undefined };
    }
    if (!Object.hasOwn(node, segment)) return { found: false, value: undefined };
    node = (node as Record<string, unknown>)[segment];
  }
  return { found: true, value: node };
}

/** Image defaults must be empty, `data:` URLs or files of the template. */
function checkImageDefault(
  value: unknown,
  where: string,
  files: ReadonlySet<string>,
  problems: string[],
) {
  if (typeof value !== "string") return;
  const url = classifyTemplateUrl(value);
  if (url.kind === "forbidden" || url.kind === "fragment" || url.kind === "root-relative") {
    problems.push(`${where}: an image default must be a template file, a data: URL or "".`);
  } else if (url.kind === "file" && !files.has(url.name)) {
    problems.push(`${where}: ${url.name} is not a file of the template.`);
  }
}

function checkDefaults(
  manifest: TemplateManifest,
  defaults: unknown,
  files: ReadonlySet<string>,
  problems: string[],
): void {
  if (typeof defaults !== "object" || defaults === null || Array.isArray(defaults)) {
    problems.push("The gift-config block must hold a JSON object.");
    return;
  }
  for (const field of manifest.fields) {
    const expected = expectedDefault(field);
    if (!expected || !field.path) continue;
    const where = `Field ${field.id} (${field.path})`;
    const { found, value } = readPath(defaults, field.path);
    if (!found) {
      problems.push(`${where}: the path does not exist in the gift-config defaults.`);
      continue;
    }
    const matches =
      expected === "string"
        ? typeof value === "string"
        : Array.isArray(value) &&
          value.every((item) =>
            expected === "strings"
              ? typeof item === "string"
              : typeof item === "object" && item !== null && !Array.isArray(item),
          );
    if (!matches) {
      const label = {
        objects: "a list of objects",
        string: "a string",
        strings: "a list of strings",
      };
      problems.push(`${where}: the default must be ${label[expected]}.`);
      continue;
    }
    if (field.type === "image") checkImageDefault(value, where, files, problems);
    if (field.type === "imageList") {
      for (const item of value as unknown[]) checkImageDefault(item, where, files, problems);
    }
    if (field.type === "captionedImageList") {
      for (const item of value as Record<string, unknown>[]) {
        checkImageDefault(item["src"], where, files, problems);
      }
    }
  }
}

function toFile(name: string, body: Uint8Array, contentType: string): HtmlTemplateFile {
  return { body, contentType, name, sha256: sha256Hex(body), sizeBytes: body.byteLength };
}

const encoder = new TextEncoder();

/** The field mapping the bootstrap of this version applies: every field but `audio`. */
export function bootstrapFieldMapping(
  manifest: TemplateManifest,
): readonly Readonly<{ id: string; path: string; type: TemplateField["type"] }>[] {
  return manifest.fields.flatMap((field) =>
    field.type === "audio" || !field.path
      ? []
      : [{ id: field.id, path: field.path, type: field.type }],
  );
}

/** The bootstrap of one version: the shared source with its field mapping embedded. */
export function renderBootstrap(bootstrap: string, manifest: TemplateManifest): string {
  if (!bootstrap.includes(BOOTSTRAP_FIELDS_MARKER)) {
    throw new Error("The bootstrap source has no field marker.");
  }
  return bootstrap.replace(BOOTSTRAP_FIELDS_MARKER, () =>
    JSON.stringify(bootstrapFieldMapping(manifest)),
  );
}

function roundKb(bytes: number): number {
  return Math.round((bytes / 1024) * 1000) / 1000;
}

/**
 * Validates an `html` template folder and builds the files of its artifact. Throws
 * `HtmlTemplateImportError` listing every problem; a refused import produces nothing.
 */
export function prepareHtmlTemplate(source: HtmlTemplateSource): PreparedHtmlTemplate {
  const problems: string[] = [];
  const documentBytes = encoder.encode(source.indexHtml).byteLength;
  if (documentBytes > HTML_TEMPLATE_LIMITS.maximumDocumentBytes) {
    problems.push("index.html must be at most 512 KB.");
  }
  checkAssets(source.assets, problems);
  const totalBytes =
    documentBytes + source.assets.reduce((total, asset) => total + asset.bytes.byteLength, 0);
  if (totalBytes > HTML_TEMPLATE_LIMITS.maximumTotalBytes) {
    problems.push("The template must be at most 8 MB in all.");
  }

  const storedManifest = completeManifest(source.manifest, problems);
  const parsedManifest = storedManifest ? TemplateManifestSchema.safeParse(storedManifest) : null;
  if (parsedManifest && !parsedManifest.success) {
    for (const issue of parsedManifest.error.issues) {
      problems.push(`template.json ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
  }
  const manifest = parsedManifest?.success ? parsedManifest.data : null;
  if (manifest?.version.includes("+")) {
    problems.push("template.json version: build metadata (+) is not supported.");
  }

  const assetNames = new Set(source.assets.map((asset) => asset.name));
  const document = parseHtmlTemplate(source.indexHtml, assetNames);
  problems.push(...document.problems);
  if (manifest) checkDefaults(manifest, document.defaults, assetNames, problems);
  if (!manifest || !storedManifest || problems.length > 0) {
    throw new HtmlTemplateImportError(problems);
  }

  const scriptFiles = document.scripts.map((script) =>
    toFile(script.fileName, encoder.encode(script.source), JAVASCRIPT_CONTENT_TYPE),
  );
  const bootstrapFile = toFile(
    LOVE_GIFT_BOOTSTRAP_FILE,
    encoder.encode(renderBootstrap(source.bootstrap, manifest)),
    JAVASCRIPT_CONTENT_TYPE,
  );
  const assetFiles = source.assets.map((asset) =>
    toFile(asset.name, asset.bytes, ASSET_CONTENT_TYPES[extensionOf(asset.name)] ?? ""),
  );
  const files = [
    toFile(HTML_TEMPLATE_ENTRY, encoder.encode(document.document), HTML_CONTENT_TYPE),
    bootstrapFile,
    ...scriptFiles,
    ...assetFiles,
  ];

  const javascript = [bootstrapFile, ...scriptFiles].map((file) => file.body);
  const metrics: TemplateBuildMetrics = {
    initialJsKbGzip: roundKb(
      javascript.reduce((total, body) => total + gzipSync(body).byteLength, 0),
    ),
    initialMediaKb: roundKb(assetFiles.reduce((total, file) => total + file.sizeBytes, 0)),
    maxTextureMb: 0,
  };
  const violations = findTemplateBudgetViolations(manifest, metrics);
  if (violations.length > 0) {
    throw new HtmlTemplateImportError(
      violations.map(
        ({ actual, limit, metric }) => `Budget ${metric}: ${actual} > ${limit} (template.json).`,
      ),
    );
  }

  return {
    artifactContentHash: computeArtifactContentHash(files),
    defaults: document.defaults as Readonly<Record<string, unknown>>,
    files,
    manifest,
    metrics,
    storedManifest,
  };
}
