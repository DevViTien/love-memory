import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { licensedAudioCatalog, type LicensedAudioTrack } from "@love-memory/domain";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const audioLibraryRoot = join(repositoryRoot, "apps", "web", "public", "audio-library");
const IGNORED_FILES = new Set([".gitkeep"]);

/** Every mismatch between catalog records and the static audio directory, one message each. */
function findAudioLibraryProblems(
  tracks: readonly LicensedAudioTrack[],
  directory: string,
): string[] {
  const present = existsSync(directory)
    ? readdirSync(directory).filter((name) => !IGNORED_FILES.has(name))
    : [];
  const referenced = new Set(tracks.map((track) => track.file.fileName));
  const problems = present
    .filter((name) => !referenced.has(name))
    .map((name) => `${name}: not referenced by the catalog`);

  for (const track of tracks) {
    const path = join(directory, track.file.fileName);
    if (!present.includes(track.file.fileName)) {
      problems.push(`${track.file.fileName}: missing for track ${track.id}`);
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.byteLength !== track.file.bytes) {
      problems.push(
        `${track.file.fileName}: ${bytes.byteLength} bytes, expected ${track.file.bytes}`,
      );
    }
    if (createHash("sha256").update(bytes).digest("hex") !== track.file.sha256) {
      problems.push(`${track.file.fileName}: sha256 does not match the catalog`);
    }
  }
  return problems;
}

describe("licensed audio library", () => {
  it("contains exactly the catalog files with their recorded size and digest", () => {
    expect(findAudioLibraryProblems(licensedAudioCatalog.tracks, audioLibraryRoot)).toEqual([]);
  });
});

describe("findAudioLibraryProblems", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { force: true, recursive: true });
  });

  function libraryWith(files: Record<string, string>) {
    const directory = mkdtempSync(join(tmpdir(), "audio-library-"));
    directories.push(directory);
    for (const [name, body] of Object.entries(files)) writeFileSync(join(directory, name), body);
    return directory;
  }

  function trackFor(id: string, body: string): LicensedAudioTrack {
    const sha256 = createHash("sha256").update(body).digest("hex");
    return {
      artist: "Nhóm Sóng",
      durationSec: 60,
      file: {
        bytes: Buffer.byteLength(body),
        fileName: `${id}.${sha256.slice(0, 16)}.mp3`,
        mimeType: "audio/mpeg",
        sha256,
      },
      id,
      license: { kind: "project-owned", reference: "test" },
      status: "active",
      title: "Test",
    };
  }

  it("accepts a consistent library and ignores .gitkeep", () => {
    const track = trackFor("calm", "audio-bytes");
    const directory = libraryWith({ ".gitkeep": "", [track.file.fileName]: "audio-bytes" });

    expect(findAudioLibraryProblems([track], directory)).toEqual([]);
  });

  it("treats a missing directory as empty", () => {
    expect(findAudioLibraryProblems([], join(tmpdir(), "does-not-exist-audio-library"))).toEqual(
      [],
    );
  });

  it("names tampered, missing and orphaned files", () => {
    const tampered = trackFor("tampered", "original");
    const missing = trackFor("missing", "gone");
    const directory = libraryWith({
      [tampered.file.fileName]: "modified",
      "orphan.0000000000000000.mp3": "x",
    });

    const problems = findAudioLibraryProblems([tampered, missing], directory);

    expect(problems).toEqual(
      expect.arrayContaining([
        "orphan.0000000000000000.mp3: not referenced by the catalog",
        `${missing.file.fileName}: missing for track missing`,
        `${tampered.file.fileName}: sha256 does not match the catalog`,
      ]),
    );
  });
});
