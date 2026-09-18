import { Container } from "@love-memory/ui";
import { notFound } from "next/navigation";

import {
  getTemplateArtifact,
  getTemplateFixture,
} from "@/modules/templates/infrastructure/template-artifact-registry";
import { ViewerShell } from "@/modules/templates/presentation/viewer-shell";

type Props = Readonly<{
  params: Promise<{ templateId: string; version: string }>;
  searchParams: Promise<{ fixture?: string }>;
}>;

export default async function TemplateViewerPage({ params, searchParams }: Props) {
  const { templateId, version } = await params;
  const artifact = getTemplateArtifact(templateId, version);
  if (!artifact) notFound();
  const fixtureName = (await searchParams).fixture ?? "default";
  const payload = getTemplateFixture(templateId, version, fixtureName);
  if (!payload) notFound();
  return (
    <main>
      <Container className="py-10">
        <p className="text-xs font-black tracking-[0.2em] text-rose-600 uppercase">
          Viewer harness
        </p>
        <h1 className="mt-2 text-3xl font-black">
          {templateId} · {version}
        </h1>
        <p className="mt-2 mb-6 text-stone-600">
          Artifact đúng phiên bản, iframe opaque-origin và message protocol được xác thực.
        </p>
        <nav aria-label="Fixture Viewer" className="mb-5 flex flex-wrap gap-2 text-sm font-bold">
          {Object.keys(artifact.fixtures).map((name) => (
            <a
              className={
                name === fixtureName
                  ? "rounded-full bg-stone-900 px-3 py-2 text-white"
                  : "rounded-full border border-stone-300 px-3 py-2"
              }
              href={`?fixture=${encodeURIComponent(name)}`}
              key={name}
            >
              {name}
            </a>
          ))}
        </nav>
        <ViewerShell
          artifactUrl={`/template-artifacts/${templateId}/${version}/${artifact.contentHash}/index.html`}
          payload={payload}
        />
      </Container>
    </main>
  );
}
