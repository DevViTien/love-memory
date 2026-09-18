import { createHash } from "node:crypto";

import { getWebEnvironment } from "@/config/environment";
import { getTemplateArtifact } from "@/modules/templates/infrastructure/template-artifact-registry";
import { createContentSecurityPolicy } from "@/security/content-security-policy";

type Context = Readonly<{
  params: Promise<{ contentHash: string; fileName: string; templateId: string; version: string }>;
}>;

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { contentHash, fileName, templateId, version } = await context.params;
  const artifact = getTemplateArtifact(templateId, version);
  const file = artifact?.contentHash === contentHash ? artifact.files[fileName] : undefined;
  if (!artifact || !file) return new Response(null, { status: 404 });
  const { assetOrigin } = getWebEnvironment();
  const fileHash = createHash("sha256").update(file.body).digest("hex");
  return new Response(file.body, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": createContentSecurityPolicy({
        ...(assetOrigin ? { assetOrigin } : {}),
        isDevelopment: process.env["NODE_ENV"] !== "production",
        mode: "template",
      }),
      "Content-Type": file.contentType,
      ETag: `\"${fileHash}\"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
