import {
  imageFieldItemRange,
  isImageField,
  type TemplateManifest,
} from "@love-memory/template-sdk";

import { type StoredTemplateSummary } from "../domain/template-summary";

/**
 * The catalog entry of a parsed manifest. `imageRequirement` adds up the photo ranges of every image
 * field (`imageList`, `captionedImageList` and `image`), and is absent without one.
 */
export function summarizeTemplateManifest(manifest: TemplateManifest): StoredTemplateSummary {
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

  return {
    description: manifest.meta.description,
    estimatedDurationSec: manifest.meta.estimatedDurationSec,
    id: manifest.id,
    ...(imageRequirement ? { imageRequirement } : {}),
    moods: manifest.meta.moods,
    name: manifest.meta.name,
    version: manifest.version,
  };
}
