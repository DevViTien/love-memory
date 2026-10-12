/** One served file of a template artifact. */
export type TemplateArtifactFile = Readonly<{ body: Uint8Array; contentType: string }>;

/**
 * A servable template version (`template-artifact-delivery`): an `sdk` release committed in the
 * repository, or an imported `html` version whose files are in object storage.
 */
export type TemplateArtifactHandle = Readonly<{
  contentHash: string;
  id: string;
  kind: "html" | "sdk";
  /** A file by its artifact path (`index.html`, `assets/photo.jpg`), or `null` when it has none. */
  readFile: (name: string) => Promise<TemplateArtifactFile | null>;
  version: string;
}>;
