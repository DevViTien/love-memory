import {
  writeFile as fsWriteFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";

import { computeContentHash } from "./artifact-checks.mjs";

/** Files copied byte for byte from `dist/` into `releases/<version>/`. */
export const RELEASE_FILES = Object.freeze([
  "index.html",
  "runtime.mjs",
  "manifest.json",
  "preview.fixture.json",
  "build-metrics.json",
  "artifact.json",
]);

/**
 * JSON with recursively sorted object keys, so key order never makes two manifests differ.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** @param {string} path */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Throws unless `dist/` is a consistent build of the manifest under development: its
 * `manifest.json` equals `template.manifest.json`, and its `artifact.json` names that manifest and
 * carries the hash of the built `index.html` and `runtime.mjs`.
 *
 * @param {Map<string, Buffer>} contents
 * @param {unknown} expectedManifest
 */
function assertConsistentBuild(contents, expectedManifest) {
  const manifest = JSON.parse(String(contents.get("manifest.json")));
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error("dist/manifest.json has no valid version.");
  }
  if (canonicalJson(manifest) !== canonicalJson(expectedManifest)) {
    throw new Error(
      `dist/manifest.json (${manifest.id}@${manifest.version}) differs from template.manifest.json; rebuild before releasing.`,
    );
  }
  const artifact = JSON.parse(String(contents.get("artifact.json")));
  const contentHash = computeContentHash(
    String(contents.get("index.html")),
    String(contents.get("runtime.mjs")),
  );
  if (artifact.contentHash !== contentHash) {
    throw new Error(
      "dist/artifact.json contentHash does not match dist/index.html and dist/runtime.mjs; rebuild before releasing.",
    );
  }
  if (artifact.id !== manifest.id || artifact.version !== manifest.version) {
    throw new Error(
      `dist/artifact.json names ${artifact.id}@${artifact.version}, not ${manifest.id}@${manifest.version}; rebuild before releasing.`,
    );
  }
  return /** @type {{ id: string; version: string }} */ (manifest);
}

/**
 * Copies a build into a new, immutable release directory named after the manifest version and
 * writes `release.json` with the served files as JSON strings. Refuses to touch an existing
 * release: once released, artifact bytes only change through a new version.
 *
 * Files are written to a staging directory next to the target and renamed into place only when
 * every write succeeded, so a failed run leaves no partial release behind and can simply be rerun.
 *
 * @param {{
 *   distDir: string;
 *   expectedManifest: unknown;
 *   releasesDir: string;
 *   writeFile?: (path: string, data: string | Buffer) => Promise<void>;
 * }} options
 * @returns {Promise<string>} the created release directory
 */
export async function createRelease({
  distDir,
  expectedManifest,
  releasesDir,
  writeFile = fsWriteFile,
}) {
  const contents = new Map(
    await Promise.all(
      RELEASE_FILES.map(
        async (name) => /** @type {const} */ ([name, await readFile(join(distDir, name))]),
      ),
    ),
  );
  const manifest = assertConsistentBuild(contents, expectedManifest);

  const target = join(releasesDir, manifest.version);
  await mkdir(releasesDir, { recursive: true });
  if (await exists(target)) {
    throw new Error(
      `Release ${manifest.id}@${manifest.version} already exists; released files are immutable.`,
    );
  }

  const served = {
    "index.html": String(contents.get("index.html")),
    "runtime.mjs": String(contents.get("runtime.mjs")),
  };
  const staging = await mkdtemp(join(releasesDir, `.staging-${manifest.version}-`));
  try {
    for (const [name, bytes] of contents) await writeFile(join(staging, name), bytes);
    await writeFile(join(staging, "release.json"), `${JSON.stringify(served, null, 2)}\n`);
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { force: true, recursive: true });
    throw error;
  }
  return target;
}
