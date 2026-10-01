import { type LicensedAudioTrackDto } from "@love-memory/contracts";
import { type MediaAsset } from "@love-memory/domain";
import { type TemplateManifest } from "@love-memory/template-sdk";

import { collectContentIssues, resolveImageReferences, toViewerFields } from "./content-issues";
import { type ViewerPayload } from "./viewer-payload";

export { selectViewerDerivative, VIEWER_ASSET_TARGET_WIDTH } from "./content-issues";

export type BuildViewerPayloadInput = Readonly<{
  /** Every asset record of the gift; only `ready` assets of the referencing field are signed. */
  assets: readonly MediaAsset[];
  content: Readonly<Record<string, unknown>>;
  /** The publication's artifact hash; a registered artifact with another hash is not used. */
  expectedContentHash?: string;
  giftId: string;
  manifest: TemplateManifest;
}>;

export type BuildViewerPayloadDependencies = Readonly<{
  clock?: () => Date;
  /** The lifetime `signDownloadUrl` gives each URL; `assetsExpireAt` is derived from it. */
  downloadUrlTtlSeconds: number;
  findSelectableTrack: (id: string) => LicensedAudioTrackDto | null;
  resolveArtifact: (id: string, version: string) => Readonly<{ contentHash: string }> | null;
  /** Signs a download URL valid for `downloadUrlTtlSeconds`. */
  signDownloadUrl: (key: string) => Promise<string>;
}>;

function resolveArtifactUrl(
  manifest: TemplateManifest,
  expectedContentHash: string | undefined,
  resolveArtifact: BuildViewerPayloadDependencies["resolveArtifact"],
): string | null {
  // Never another version: a gift is pinned to the exact version it was created with.
  const artifact = resolveArtifact(manifest.id, manifest.version);
  if (!artifact) return null;
  if (expectedContentHash !== undefined && artifact.contentHash !== expectedContentHash) {
    return null;
  }
  return `/template-artifacts/${manifest.id}/${manifest.version}/${artifact.contentHash}/index.html`;
}

/**
 * Turns an authorized gift's bound manifest, stored content, asset records and the audio catalog
 * into the input of a gift viewer. It never logs; it throws only when signing throws.
 */
export async function buildViewerPayload(
  input: BuildViewerPayloadInput,
  dependencies: BuildViewerPayloadDependencies,
): Promise<ViewerPayload> {
  const { content, manifest } = input;
  const clock = dependencies.clock ?? (() => new Date());
  // The same checks publish runs, so a preview without issues is a publishable revision.
  const issues = collectContentIssues(input, dependencies);

  const audioField = manifest.fields.find((field) => field.type === "audio");
  const audioValue = audioField ? content[audioField.id] : undefined;
  const track =
    typeof audioValue === "string" ? dependencies.findSelectableTrack(audioValue) : null;

  const toSign = resolveImageReferences(input).available;

  // Taken before signing, so it is never later than the earliest URL expiry.
  const signedAt = clock();
  const signed = await Promise.all(
    toSign.map(
      async ({ assetId, key }) => [assetId, await dependencies.signDownloadUrl(key)] as const,
    ),
  );
  const assets = Object.fromEntries(signed);

  return {
    artifactUrl: resolveArtifactUrl(
      manifest,
      input.expectedContentHash,
      dependencies.resolveArtifact,
    ),
    assets,
    assetsExpireAt:
      signed.length > 0
        ? new Date(signedAt.getTime() + dependencies.downloadUrlTtlSeconds * 1000).toISOString()
        : null,
    audioUrl: track?.url ?? null,
    fields: toViewerFields(manifest),
    issues,
    payload: content,
  };
}
