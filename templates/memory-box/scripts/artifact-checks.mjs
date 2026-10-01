import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

/**
 * APIs the bundled runtime must never reference: the template has no network, storage, worker or
 * media access (template CSP plus the "Artifact constraints" requirement).
 */
export const FORBIDDEN_RUNTIME_APIS = Object.freeze([
  { name: "fetch", pattern: /\bfetch\s*\(/ },
  { name: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  { name: "WebSocket", pattern: /\bWebSocket\b/ },
  { name: "EventSource", pattern: /\bEventSource\b/ },
  { name: "navigator.sendBeacon", pattern: /\bsendBeacon\b/ },
  { name: "localStorage", pattern: /\blocalStorage\b/ },
  { name: "sessionStorage", pattern: /\bsessionStorage\b/ },
  { name: "indexedDB", pattern: /\bindexedDB\b/ },
  { name: "Worker", pattern: /Worker\s*\(/ },
  { name: "<audio> element", pattern: /createElement\(\s*["'`]audio["'`]\s*\)|<audio\b/i },
  { name: "<video> element", pattern: /createElement\(\s*["'`]video["'`]\s*\)|<video\b/i },
]);

const MODULE_IMPORT_PATTERNS = Object.freeze([
  { name: "import statement", pattern: /(?:^|[;{}\n])\s*import\s*(?:[\w$*{]|["'`])/ },
  { name: "import()", pattern: /\bimport\s*\(/ },
]);

/**
 * Names every forbidden API or module import found in the bundled runtime source.
 *
 * @param {string} code
 * @returns {string[]}
 */
export function findRuntimeViolations(code) {
  return [...MODULE_IMPORT_PATTERNS, ...FORBIDDEN_RUNTIME_APIS]
    .filter(({ pattern }) => pattern.test(code))
    .map(({ name }) => name);
}

/**
 * Returns the code of the single output chunk, or throws when the bundle is not exactly one
 * self-contained chunk without extra assets.
 *
 * @param {ReadonlyArray<{ type: string; fileName: string; code?: string }>} outputs
 * @returns {string}
 */
export function selectSingleRuntimeChunk(outputs) {
  const chunks = outputs.filter((output) => output.type === "chunk");
  const assets = outputs.filter((output) => output.type !== "chunk");
  if (chunks.length !== 1 || assets.length > 0) {
    throw new Error(
      `Expected exactly one runtime chunk and no assets, got: ${outputs
        .map((output) => output.fileName)
        .join(", ")}`,
    );
  }
  return chunks[0]?.code ?? "";
}

/**
 * Throws naming each violation of the artifact constraints.
 *
 * @param {string} runtime
 * @param {string} document
 */
export function assertArtifactConstraints(runtime, document) {
  const violations = findRuntimeViolations(runtime);
  if (/<(?:audio|video)\b/i.test(document)) violations.push("<audio>/<video> in index.html");
  if (violations.length > 0) {
    throw new Error(`Template artifact uses forbidden APIs: ${violations.join(", ")}`);
  }
}

/**
 * The content hash shared by the web artifact registry: SHA-256 of `document \0 runtime`.
 *
 * @param {string} document
 * @param {string} runtime
 * @returns {string}
 */
export function computeContentHash(document, runtime) {
  return createHash("sha256").update(document).update("\0").update(runtime).digest("hex");
}

/**
 * @param {string} runtime
 * @returns {{ initialJsKbGzip: number; initialMediaKb: number; maxTextureMb: number }}
 */
export function measureBuild(runtime) {
  return {
    initialJsKbGzip: Number((gzipSync(runtime).byteLength / 1024).toFixed(3)),
    initialMediaKb: 0,
    maxTextureMb: 0,
  };
}
