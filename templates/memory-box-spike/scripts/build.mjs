import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { MEMORY_BOX_SPIKE_DOCUMENT, MEMORY_BOX_SPIKE_RUNTIME } from "../.build/document.js";

const templateRoot = new URL("../", import.meta.url);
const outputRoot = new URL("../dist/", import.meta.url);
const fixture = await readFile(new URL("preview.fixture.json", templateRoot), "utf8");
const manifest = JSON.parse(
  await readFile(new URL("template.manifest.json", templateRoot), "utf8"),
);
const contentHash = createHash("sha256")
  .update(MEMORY_BOX_SPIKE_DOCUMENT)
  .update("\0")
  .update(MEMORY_BOX_SPIKE_RUNTIME)
  .digest("hex");
const metrics = {
  initialJsKbGzip: Number((gzipSync(MEMORY_BOX_SPIKE_RUNTIME).byteLength / 1024).toFixed(3)),
  initialMediaKb: 0,
  maxTextureMb: 0,
};

await mkdir(outputRoot, { recursive: true });
await Promise.all([
  writeFile(new URL("index.html", outputRoot), MEMORY_BOX_SPIKE_DOCUMENT, "utf8"),
  writeFile(new URL("runtime.mjs", outputRoot), MEMORY_BOX_SPIKE_RUNTIME, "utf8"),
  writeFile(new URL("preview.fixture.json", outputRoot), fixture, "utf8"),
  writeFile(new URL("manifest.json", outputRoot), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  writeFile(
    new URL("build-metrics.json", outputRoot),
    `${JSON.stringify(metrics, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    new URL("artifact.json", outputRoot),
    `${JSON.stringify(
      {
        contentHash,
        engineVersion: manifest.engineVersion,
        entry: manifest.entry,
        id: manifest.id,
        version: manifest.version,
      },
      null,
      2,
    )}\n`,
    "utf8",
  ),
]);
