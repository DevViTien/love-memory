import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createRelease } from "./release-files.mjs";

const templateRoot = new URL("../", import.meta.url);
const target = await createRelease({
  distDir: fileURLToPath(new URL("dist/", templateRoot)),
  expectedManifest: JSON.parse(
    await readFile(new URL("template.manifest.json", templateRoot), "utf8"),
  ),
  releasesDir: fileURLToPath(new URL("releases/", templateRoot)),
});

process.stdout.write(`Created release ${target}\n`);
