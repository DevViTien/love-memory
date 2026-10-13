import { MEMORY_BOX_RELEASES } from "@love-memory/template-memory-box";
import {
  parseTemplateManifest,
  parseTemplatePayload,
  type TemplateManifest,
} from "@love-memory/template-sdk";

import { summarizeTemplateManifest } from "../application/summarize-template";
import { type TemplateCatalog } from "../domain/template-summary";
import { canonicalJson, type SeedTemplateRelease } from "./template-release-seed";

/**
 * The first `memory-box` release, kept exactly as it was first stored. It is `retired`: existing
 * drafts stay editable against it, new drafts use `1.1.0`. Its inner `status` stays `published`
 * so that the stored manifest is never rewritten; lookups use the registry document status.
 */
const memoryBox_1_0_0 = {
  budgets: { initialJsKbGzip: 120, initialMediaKb: 700, maxTextureMb: 32 },
  capabilities: ["audio", "dom"],
  engineVersion: "1.0.0",
  entry: "index.js",
  fields: [
    {
      id: "headline",
      label: "Lời mở đầu",
      maxLength: 120,
      required: true,
      type: "shortText",
    },
    {
      aspectRatio: "4:5",
      id: "photos",
      label: "Ảnh kỷ niệm",
      maxItems: 8,
      minItems: 3,
      required: true,
      type: "imageList",
    },
    {
      id: "final-message",
      label: "Lá thư cuối",
      maxLength: 1200,
      required: true,
      type: "longText",
    },
  ],
  id: "memory-box",
  meta: {
    description: "Mở chiếc hộp, để từng tấm ảnh bay ra và kết thúc bằng một lá thư.",
    estimatedDurationSec: 75,
    moods: ["warm", "playful"],
    name: "Hộp ký ức",
    occasions: ["anniversary", "birthday"],
  },
  previewFixture: "fixtures/demo.json",
  status: "published",
  version: "1.0.0",
};

const memoryBox_1_1_0 = MEMORY_BOX_RELEASES.find((release) => release.version === "1.1.0");
if (!memoryBox_1_1_0) throw new Error("The committed memory-box@1.1.0 release is missing.");

/**
 * Templates an earlier seed published as catalog placeholders (manifests without an artifact,
 * `Sắp ra mắt`), replaced by the `html` templates of the pivot (`template-pivot-plan.md` T9). The
 * seed no longer creates them and retires them, with these versions, where they are stored, so
 * drafts that pin them stay editable while the catalog and new drafts leave them out.
 */
export const RETIRED_SEED_TEMPLATES: readonly Readonly<{
  templateId: string;
  versions: readonly string[];
}>[] = Object.freeze([
  { templateId: "our-timeline", versions: ["1.0.0"] },
  { templateId: "midnight-wish", versions: ["1.0.0"] },
]);

/** Seeded launch templates in `sortOrder`, each with every stored version. */
export const seedTemplateReleases: readonly SeedTemplateRelease[] = [
  {
    currentVersion: "1.1.0",
    templateId: "memory-box",
    versions: [
      {
        manifest: memoryBox_1_0_0,
        previewFixture: {
          "final-message": "Cảm ơn vì đã cùng mình tạo nên những ký ức thật đẹp.",
          headline: "Mở hộp ký ức của chúng mình",
          photos: [
            "550e8400-e29b-41d4-a716-446655440001",
            "550e8400-e29b-41d4-a716-446655440002",
            "550e8400-e29b-41d4-a716-446655440003",
          ],
        },
        status: "retired",
      },
      {
        manifest: memoryBox_1_1_0.manifest,
        previewFixture: memoryBox_1_1_0.previewFixture,
        status: "published",
      },
    ],
  },
];

/**
 * Validates the seed releases: every manifest parses and belongs to its template, its preview
 * fixture validates, the raw manifest has no hidden parser defaults, and the current version is
 * published. Returns the parsed current manifests in `sortOrder`.
 */
export function assertSeedTemplateReleases(
  releases: readonly SeedTemplateRelease[],
): TemplateManifest[] {
  return releases.map((release) => {
    let current: TemplateManifest | undefined;
    for (const version of release.versions) {
      const manifest = parseTemplateManifest(version.manifest);
      const id = `${release.templateId}@${manifest.version}`;
      if (manifest.id !== release.templateId) {
        throw new Error(`Seed manifest ${id} declares template ${manifest.id}`);
      }
      if (canonicalJson(manifest) !== canonicalJson(version.manifest)) {
        throw new Error(`Seed manifest ${id} relies on parser defaults`);
      }
      parseTemplatePayload(manifest, version.previewFixture);
      if (manifest.version === release.currentVersion && version.status === "published") {
        current = manifest;
      }
    }
    if (!current) {
      throw new Error(
        `Template ${release.templateId} current version ${release.currentVersion} is not published`,
      );
    }
    return current;
  });
}

/** Parsed current manifests of the seeded templates, in `sortOrder`. */
export const seedTemplateCurrentManifests: readonly TemplateManifest[] = Object.freeze(
  assertSeedTemplateReleases(seedTemplateReleases),
);

/** Parsed manifests of every seeded version, including retired ones. */
export const seedTemplateVersionManifests: readonly TemplateManifest[] = Object.freeze(
  seedTemplateReleases.flatMap((release) =>
    release.versions.map((version) => parseTemplateManifest(version.manifest)),
  ),
);

const templates = Object.freeze(
  seedTemplateCurrentManifests.map((manifest) => summarizeTemplateManifest(manifest)),
);

export const seedTemplateCatalog: TemplateCatalog = {
  findPublishedById(id) {
    return Promise.resolve(templates.find((template) => template.id === id));
  },
  listPublished() {
    return Promise.resolve(templates);
  },
};
