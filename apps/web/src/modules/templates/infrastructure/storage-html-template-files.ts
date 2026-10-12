import { createHash } from "node:crypto";

import { type ObjectStorage, ObjectNotFoundError } from "@love-memory/storage";

import { type HtmlTemplateFileStore } from "../application/import-html-template";

/** Template files never change at their content-addressed key: one year of caching is safe. */
const TEMPLATE_FILE_CACHE_SECONDS = 365 * 24 * 60 * 60;
/** Imported files are at most 2 MB; the entry document at most 512 KB. */
const MAXIMUM_FILE_BYTES = 2 * 1024 * 1024;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Writes each imported file at its content-addressed key. An object already there is kept when
 * its size and SHA-256 match the file, and rewritten otherwise (a damaged or partial object).
 */
export function createStorageHtmlTemplateFiles(
  storage: Pick<ObjectStorage, "getObject" | "getObjectMetadata" | "putObject">,
): HtmlTemplateFileStore {
  return {
    async putFile(key, body, contentType) {
      let exists = true;
      try {
        const metadata = await storage.getObjectMetadata(key);
        if (
          metadata.contentLength === body.byteLength &&
          sha256(await storage.getObject(key, MAXIMUM_FILE_BYTES)) === sha256(body)
        ) {
          return;
        }
      } catch (error) {
        if (!(error instanceof ObjectNotFoundError)) throw error;
        exists = false;
      }
      await storage.putObject({
        allowOverwrite: exists,
        body,
        cacheControlMaxAge: TEMPLATE_FILE_CACHE_SECONDS,
        contentType,
        key,
      });
    },
  };
}
