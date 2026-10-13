import {
  imageFieldItemRange,
  isImageField,
  templateKindOf,
  type TemplateManifest,
} from "@love-memory/template-sdk";

import { type StoredTemplateSummary } from "../domain/template-summary";

/** The catalog picture of an `html` template, a file of its folder (`templates-html/README.md`). */
export const HTML_TEMPLATE_THUMBNAIL_FILE = "assets/thumbnail.jpg";

/** The served URL of one file of a content-addressed template artifact (same origin). */
export function templateArtifactFileUrl(
  templateId: string,
  version: string,
  artifactContentHash: string,
  fileName: string,
): string {
  return `/template-artifacts/${templateId}/${version}/${artifactContentHash}/${fileName}`;
}

/** What the catalog knows of a stored `html` artifact: its content address and file names. */
export type StoredHtmlArtifact = Readonly<{
  artifactContentHash: string;
  fileNames: readonly string[];
}>;

/**
 * The catalog entry of a parsed manifest. `imageRequirement` adds up the photo ranges of every image
 * field (`imageList`, `captionedImageList` and `image`), and is absent without one. An `html`
 * version whose artifact holds `assets/thumbnail.jpg` gets that file as its `thumbnailUrl`.
 */
export function summarizeTemplateManifest(
  manifest: TemplateManifest,
  artifact?: StoredHtmlArtifact,
): StoredTemplateSummary {
  const imageFields = manifest.fields.filter(isImageField).map(imageFieldItemRange);
  const imageRequirement =
    imageFields.length > 0
      ? imageFields.reduce(
          (total, range) => ({
            maxItems: total.maxItems + range.maxItems,
            minItems: total.minItems + range.minItems,
          }),
          { maxItems: 0, minItems: 0 },
        )
      : null;
  const thumbnailUrl =
    artifact &&
    templateKindOf(manifest) === "html" &&
    artifact.fileNames.includes(HTML_TEMPLATE_THUMBNAIL_FILE)
      ? templateArtifactFileUrl(
          manifest.id,
          manifest.version,
          artifact.artifactContentHash,
          HTML_TEMPLATE_THUMBNAIL_FILE,
        )
      : null;

  return {
    description: manifest.meta.description,
    estimatedDurationSec: manifest.meta.estimatedDurationSec,
    id: manifest.id,
    ...(imageRequirement ? { imageRequirement } : {}),
    moods: manifest.meta.moods,
    name: manifest.meta.name,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    version: manifest.version,
  };
}
