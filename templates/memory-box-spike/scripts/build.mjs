import { gzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { MEMORY_BOX_SPIKE_DOCUMENT } from "../.build/document.js";

const templateRoot = new URL("../", import.meta.url);
const outputRoot = new URL("../dist/", import.meta.url);
const fixture = await readFile(new URL("preview.fixture.json", templateRoot), "utf8");
const inlineScript = /<script>([\s\S]*?)<\/script>/.exec(MEMORY_BOX_SPIKE_DOCUMENT)?.[1] ?? "";
const metrics = {
  initialJsKbGzip: Number((gzipSync(inlineScript).byteLength / 1024).toFixed(3)),
  initialMediaKb: 0,
  maxTextureMb: 0,
};

await mkdir(outputRoot, { recursive: true });
await Promise.all([
  writeFile(new URL("index.html", outputRoot), MEMORY_BOX_SPIKE_DOCUMENT, "utf8"),
  writeFile(new URL("preview.fixture.json", outputRoot), fixture, "utf8"),
  writeFile(
    new URL("build-metrics.json", outputRoot),
    `${JSON.stringify(metrics, null, 2)}\n`,
    "utf8",
  ),
]);
