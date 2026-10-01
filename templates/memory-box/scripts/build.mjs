import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build, minify, runnerImport } from "vite";

import {
  assertArtifactConstraints,
  computeContentHash,
  measureBuild,
  selectSingleRuntimeChunk,
} from "./artifact-checks.mjs";

const templateRoot = new URL("../", import.meta.url);
const outputRoot = new URL("dist/", templateRoot);

async function bundleRuntime() {
  const result = await build({
    build: {
      copyPublicDir: false,
      lib: {
        entry: fileURLToPath(new URL("src/runtime/main.ts", templateRoot)),
        fileName: "runtime",
        formats: ["es"],
      },
      minify: true,
      modulePreload: false,
      reportCompressedSize: false,
      target: "es2022",
      write: false,
    },
    configFile: false,
    logLevel: "warn",
    publicDir: false,
    root: fileURLToPath(templateRoot),
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) =>
    "output" in entry ? entry.output : [],
  );
  const chunk = selectSingleRuntimeChunk(outputs);
  // Library mode keeps whitespace in ES output; minify the whole module once more.
  const minified = await minify("runtime.mjs", chunk, {
    compress: true,
    mangle: true,
    module: true,
  });
  if (minified.errors.length > 0) {
    throw new Error(
      `Runtime minification failed: ${minified.errors.map((error) => error.message).join("; ")}`,
    );
  }
  return minified.code;
}

async function loadDocument() {
  /** @type {{ module: { MEMORY_BOX_DOCUMENT: string } }} */
  const { module } = await runnerImport(fileURLToPath(new URL("src/document.ts", templateRoot)), {
    configFile: false,
    logLevel: "warn",
  });
  return module.MEMORY_BOX_DOCUMENT;
}

/** @param {unknown} value */
function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const runtime = await bundleRuntime();
const document = await loadDocument();
assertArtifactConstraints(runtime, document);

const manifest = JSON.parse(
  await readFile(new URL("template.manifest.json", templateRoot), "utf8"),
);
const fixture = await readFile(new URL(manifest.previewFixture, templateRoot), "utf8");

await rm(outputRoot, { force: true, recursive: true });
await mkdir(outputRoot, { recursive: true });
await Promise.all([
  writeFile(new URL("index.html", outputRoot), document, "utf8"),
  writeFile(new URL("runtime.mjs", outputRoot), runtime, "utf8"),
  writeFile(new URL(manifest.previewFixture, outputRoot), fixture, "utf8"),
  writeFile(new URL("manifest.json", outputRoot), json(manifest), "utf8"),
  writeFile(new URL("build-metrics.json", outputRoot), json(measureBuild(runtime)), "utf8"),
  writeFile(
    new URL("artifact.json", outputRoot),
    json({
      contentHash: computeContentHash(document, runtime),
      engineVersion: manifest.engineVersion,
      entry: manifest.entry,
      id: manifest.id,
      version: manifest.version,
    }),
    "utf8",
  ),
]);
