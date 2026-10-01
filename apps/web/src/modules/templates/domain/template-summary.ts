/** A listed template version as the registry stores it, before its availability is known. */
export type StoredTemplateSummary = Readonly<{
  description: string;
  estimatedDurationSec: number;
  id: string;
  imageRequirement?: Readonly<{
    maxItems: number;
    minItems: number;
  }>;
  moods: readonly string[];
  name: string;
  version: string;
}>;

/**
 * A catalog entry. `available` is `true` only when a template artifact is registered for the exact
 * version, so a gift created from it can be previewed with the template and published.
 */
export type TemplateSummary = StoredTemplateSummary & Readonly<{ available: boolean }>;

export interface TemplateCatalog {
  findPublishedById(id: string): Promise<StoredTemplateSummary | undefined>;
  listPublished(): Promise<readonly StoredTemplateSummary[]>;
}

/** Whether a template artifact is registered for the exact `id` and `version`. */
export type TemplateAvailability = (id: string, version: string) => boolean;
