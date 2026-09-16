export type TemplateSummary = Readonly<{
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

export interface TemplateCatalog {
  findPublishedById(id: string): Promise<TemplateSummary | undefined>;
  listPublished(): Promise<readonly TemplateSummary[]>;
}
