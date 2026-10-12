import { createHash } from "node:crypto";

import { type ObjectStorage, ObjectNotFoundError } from "@love-memory/storage";

import { type TemplateArtifactHandle } from "../domain/template-artifact";
import { type HtmlTemplateArtifactRecord } from "./mongo-html-template-repository";

/** Imported files are at most 2 MB; the entry document at most 512 KB. */
const MAXIMUM_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Servable `html` versions (`template-artifact-delivery`): the stored document names the files and
 * their hashes, object storage holds the bytes. A file whose bytes no longer match its recorded
 * SHA-256 is not served.
 */
export function createHtmlTemplateArtifactSource({
  findArtifact,
  storage,
}: Readonly<{
  findArtifact: (templateId: string, version: string) => Promise<HtmlTemplateArtifactRecord | null>;
  storage: () => Pick<ObjectStorage, "getObject">;
}>) {
  return {
    async find(templateId: string, version: string): Promise<TemplateArtifactHandle | null> {
      const record = await findArtifact(templateId, version);
      if (!record) return null;
      return {
        contentHash: record.artifactContentHash,
        id: templateId,
        kind: "html",
        async readFile(name) {
          const file = record.files.find((candidate) => candidate.name === name);
          if (!file) return null;
          let body: Uint8Array;
          try {
            body = await storage().getObject(file.storageKey, MAXIMUM_FILE_BYTES);
          } catch (error) {
            // A file missing from storage is a missing file (404), not a server error.
            if (error instanceof ObjectNotFoundError) return null;
            throw error;
          }
          const sha256 = createHash("sha256").update(body).digest("hex");
          return sha256 === file.sha256 ? { body, contentType: file.contentType } : null;
        },
        version,
      };
    },
  } as const;
}
