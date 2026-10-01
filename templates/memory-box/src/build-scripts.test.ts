// @vitest-environment node
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertArtifactConstraints,
  computeContentHash,
  findRuntimeViolations,
  measureBuild,
  selectSingleRuntimeChunk,
} from "../scripts/artifact-checks.mjs";
import { canonicalJson, createRelease, RELEASE_FILES } from "../scripts/release-files.mjs";

describe("artifact checks", () => {
  it("accepts a self-contained runtime without forbidden APIs", () => {
    expect(
      findRuntimeViolations(
        'const e=document.createElement(`img`);parent.postMessage({type:"READY"},"*");export{e as a};',
      ),
    ).toEqual([]);
  });

  it("names forbidden network, worker, storage and media APIs and module imports", () => {
    expect(
      findRuntimeViolations(
        'fetch("/x");import("./y.js");new Worker("w.js");localStorage.x=1;navigator.sendBeacon("/b")',
      ),
    ).toEqual(["import()", "fetch", "navigator.sendBeacon", "localStorage", "Worker"]);
    expect(findRuntimeViolations('import{a}from"./a.js";a()')).toEqual(["import statement"]);
    expect(findRuntimeViolations("document.createElement(`audio`)")).toEqual(["<audio> element"]);
    expect(findRuntimeViolations('document.createElement("video")')).toEqual(["<video> element"]);
    expect(
      findRuntimeViolations(
        "new XMLHttpRequest;new WebSocket(u);new EventSource(u);indexedDB;sessionStorage",
      ),
    ).toEqual(["XMLHttpRequest", "WebSocket", "EventSource", "sessionStorage", "indexedDB"]);
  });

  it("fails the build naming each violation, including media elements in the document", () => {
    expect(() => assertArtifactConstraints('fetch("/x")', "<p></p>")).toThrow(
      "Template artifact uses forbidden APIs: fetch",
    );
    expect(() => assertArtifactConstraints("", "<audio src=x>")).toThrow("<audio>/<video>");
    expect(() => assertArtifactConstraints("let a=1", "<main></main>")).not.toThrow();
  });

  it("requires exactly one chunk and no assets", () => {
    expect(selectSingleRuntimeChunk([{ code: "a", fileName: "runtime.js", type: "chunk" }])).toBe(
      "a",
    );
    expect(() =>
      selectSingleRuntimeChunk([
        { code: "a", fileName: "runtime.js", type: "chunk" },
        { code: "b", fileName: "chunk.js", type: "chunk" },
      ]),
    ).toThrow("runtime.js, chunk.js");
    expect(() =>
      selectSingleRuntimeChunk([
        { code: "a", fileName: "runtime.js", type: "chunk" },
        { fileName: "style.css", type: "asset" },
      ]),
    ).toThrow("exactly one runtime chunk");
  });

  it("hashes document NUL runtime and measures gzip size", () => {
    expect(computeContentHash("doc", "run")).toMatch(/^[a-f0-9]{64}$/);
    expect(computeContentHash("doc", "run")).not.toBe(computeContentHash("do", "crun"));
    expect(measureBuild("x".repeat(2048))).toMatchObject({ initialMediaKb: 0, maxTextureMb: 0 });
  });
});

describe("createRelease", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  });

  function fileBody(name: string): string {
    return `${name} ✓ Kỷ niệm\n`;
  }

  /** A consistent fake build of `memory-box@<version>` and the manifest it was built from. */
  async function fakeDist(version = "1.2.3") {
    const root = await mkdtemp(join(tmpdir(), "memory-box-release-"));
    directories.push(root);
    const distDir = join(root, "dist");
    await mkdir(distDir);
    for (const name of RELEASE_FILES) {
      await writeFile(join(distDir, name), fileBody(name));
    }
    const manifest = { id: "memory-box", version };
    await writeFile(join(distDir, "manifest.json"), JSON.stringify(manifest));
    await writeFile(
      join(distDir, "artifact.json"),
      JSON.stringify({
        contentHash: computeContentHash(fileBody("index.html"), fileBody("runtime.mjs")),
        id: "memory-box",
        version,
      }),
    );
    return {
      distDir,
      expectedManifest: { version, id: "memory-box" } as unknown,
      releasesDir: join(root, "releases"),
    };
  }

  it("copies the build into a new version directory with release.json", async () => {
    const options = await fakeDist();

    const target = await createRelease(options);

    expect(target).toBe(join(options.releasesDir, "1.2.3"));
    expect(await readdir(options.releasesDir)).toEqual(["1.2.3"]);
    expect((await readdir(target)).sort()).toEqual([...RELEASE_FILES, "release.json"].sort());
    for (const name of RELEASE_FILES) {
      expect(await readFile(join(target, name))).toEqual(
        await readFile(join(options.distDir, name)),
      );
    }
    const release = JSON.parse(await readFile(join(target, "release.json"), "utf8")) as Record<
      string,
      string
    >;
    expect(release).toEqual({
      "index.html": await readFile(join(target, "index.html"), "utf8"),
      "runtime.mjs": await readFile(join(target, "runtime.mjs"), "utf8"),
    });
  });

  it("refuses to write into an existing release", async () => {
    const options = await fakeDist();
    const existing = join(options.releasesDir, "1.2.3");
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, "runtime.mjs"), "released");

    await expect(createRelease(options)).rejects.toThrow(
      "Release memory-box@1.2.3 already exists; released files are immutable.",
    );
    expect(await readdir(options.releasesDir)).toEqual(["1.2.3"]);
    expect(await readdir(existing)).toEqual(["runtime.mjs"]);
    expect(await readFile(join(existing, "runtime.mjs"), "utf8")).toBe("released");
  });

  it("rejects a build without a valid manifest version and writes nothing", async () => {
    const options = await fakeDist("latest");

    await expect(createRelease(options)).rejects.toThrow("no valid version");
    expect(existsSync(options.releasesDir)).toBe(false);
  });

  it("rejects a build whose manifest differs from template.manifest.json", async () => {
    const options = await fakeDist();

    await expect(
      createRelease({ ...options, expectedManifest: { id: "memory-box", version: "1.2.4" } }),
    ).rejects.toThrow("dist/manifest.json (memory-box@1.2.3) differs from template.manifest.json");
    expect(existsSync(options.releasesDir)).toBe(false);
  });

  it("rejects a build whose artifact.json hash does not match its files", async () => {
    const options = await fakeDist();
    await writeFile(join(options.distDir, "runtime.mjs"), "edited after the build");

    await expect(createRelease(options)).rejects.toThrow(
      "dist/artifact.json contentHash does not match",
    );
    expect(existsSync(options.releasesDir)).toBe(false);
  });

  it("rejects an artifact.json that names another version", async () => {
    const options = await fakeDist();
    await writeFile(
      join(options.distDir, "artifact.json"),
      JSON.stringify({
        contentHash: computeContentHash(fileBody("index.html"), fileBody("runtime.mjs")),
        id: "memory-box",
        version: "1.2.2",
      }),
    );

    await expect(createRelease(options)).rejects.toThrow(
      "dist/artifact.json names memory-box@1.2.2, not memory-box@1.2.3",
    );
  });

  it("leaves nothing behind when a write fails, so a rerun succeeds", async () => {
    const options = await fakeDist();
    let writes = 0;
    const failingWrite = async (path: string, data: string | Buffer) => {
      writes += 1;
      if (writes === 3) throw new Error("disk full");
      await writeFile(path, data);
    };

    await expect(createRelease({ ...options, writeFile: failingWrite })).rejects.toThrow(
      "disk full",
    );
    expect(await readdir(options.releasesDir)).toEqual([]);

    const target = await createRelease(options);
    expect((await readdir(target)).sort()).toEqual([...RELEASE_FILES, "release.json"].sort());
    expect(await readdir(options.releasesDir)).toEqual(["1.2.3"]);
  });
});

describe("canonicalJson", () => {
  it("sorts object keys recursively and keeps array order", () => {
    expect(canonicalJson({ b: [2, { d: 1, c: null }], a: "x" })).toBe(
      '{"a":"x","b":[2,{"c":null,"d":1}]}',
    );
    expect(canonicalJson(undefined)).toBe("null");
  });
});
