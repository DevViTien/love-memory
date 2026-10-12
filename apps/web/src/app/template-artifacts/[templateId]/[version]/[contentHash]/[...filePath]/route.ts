import { createHash } from "node:crypto";

import { getLocalObjectStorageOrigin } from "@love-memory/storage";

import { getWebEnvironment } from "@/config/environment";
import { resolveTemplateArtifact } from "@/composition/templates";
import {
  createContentSecurityPolicy,
  templateArtifactOrigin,
} from "@/security/content-security-policy";

type Context = Readonly<{
  params: Promise<{ contentHash: string; filePath: string[]; templateId: string; version: string }>;
}>;

/** One path segment of an artifact file: the object key rules, so `..`, `%` and `\` never pass. */
const FILE_SEGMENT = /^(?:[A-Za-z0-9_-]|[A-Za-z0-9_-][A-Za-z0-9._-]{0,126}[A-Za-z0-9_-])$/;
const MAXIMUM_SEGMENTS = 6;

function notFound(): Response {
  return new Response(null, { status: 404 });
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { contentHash, filePath, templateId, version } = await context.params;
  if (
    filePath.length === 0 ||
    filePath.length > MAXIMUM_SEGMENTS ||
    !filePath.every((segment) => FILE_SEGMENT.test(segment))
  ) {
    return notFound();
  }
  // A killed version answers 404 like an unknown one (`template-version-controls`).
  const artifact = await resolveTemplateArtifact(templateId, version);
  if (!artifact || artifact.contentHash !== contentHash) return notFound();
  const file = await artifact.readFile(filePath.join("/"));
  if (!file) return notFound();

  const { appUrl, assetOrigin } = getWebEnvironment();
  const localStorageOrigin = getLocalObjectStorageOrigin(process.env);
  const fileHash = createHash("sha256").update(file.body).digest("hex");
  return new Response(Buffer.from(file.body), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      // In local storage mode the policy depends on the environment, so it must not be cached.
      "Cache-Control": localStorageOrigin ? "no-store" : "public, max-age=31536000, immutable",
      "Content-Security-Policy": createContentSecurityPolicy({
        ...(assetOrigin ? { assetOrigin } : {}),
        isDevelopment: process.env["NODE_ENV"] !== "production",
        ...(localStorageOrigin ? { localStorageOrigin } : {}),
        mode: "template",
        // Opened as a page, the artifact still runs in an opaque origin.
        sandbox: true,
        templateOrigin: templateArtifactOrigin(appUrl, request),
      }),
      "Content-Type": file.contentType,
      ETag: `\"${fileHash}\"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
