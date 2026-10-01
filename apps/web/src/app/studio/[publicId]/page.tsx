import { ROUTES } from "@love-memory/shared";
import { Badge, buttonVariants, Container } from "@love-memory/ui";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { audioCatalog } from "@/composition/audio";
import { getGiftTemplateManifest, giftService } from "@/composition/gifts";
import { isTemplateVersionAvailable } from "@/composition/templates";
import { getInternalPublishEnvironment } from "@/config/internal-publish";
import { ClaimDraftButton } from "@/modules/gifts/presentation/claim-draft-button";
import { DraftEditor } from "@/modules/gifts/presentation/draft-editor";
import { getGiftRequestContextFromHeaders } from "@/modules/gifts/presentation/gift-route-helpers";
import { PublishedPanel } from "@/modules/gifts/presentation/studio/published-panel";

type StudioDraftPageProps = Readonly<{
  params: Promise<{ publicId: string }>;
}>;

export const dynamic = "force-dynamic";

export default async function StudioDraftPage({ params }: StudioDraftPageProps) {
  const publicId = (await params).publicId;
  const context = await getGiftRequestContextFromHeaders(await headers());

  const result = await giftService.getStudioGift({ accessors: context.accessors, publicId });

  if (!result.ok) {
    notFound();
  }

  // A published gift is read-only: the share link instead of the editor, and no draft request.
  if (result.data.kind === "published") {
    return (
      <main>
        <Container className="py-10 sm:py-14">
          <div className="mx-auto max-w-2xl">
            <PublishedPanel publication={result.data.publication} />
          </div>
        </Container>
      </main>
    );
  }

  let draft = result.data.draft;
  // Back from the sign-in link in the browser that holds the draft: claim it now, so publishing
  // needs no second step. Same atomic, credential-filtered write as `POST .../claim`.
  if (draft.ownerKind === "anonymous" && context.userId && context.anonymousIdentity) {
    const claimed = await giftService.claimDraft({
      anonymousDraftId: context.anonymousIdentity.anonymousDraftId,
      claimTokenHash: context.anonymousIdentity.claimTokenHash,
      publicId,
      userId: context.userId,
    });
    if (claimed.ok) draft = claimed.data;
  }
  const manifest = await getGiftTemplateManifest(draft.templateId, draft.templateVersion);
  if (!manifest) {
    throw new Error("Gift template version is unavailable.");
  }

  return (
    <main>
      <Container className="py-10 sm:py-14">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <section className="min-w-0 rounded-[2rem] border border-rose-100 bg-white/90 p-6 shadow-lg shadow-rose-100/50 sm:p-9">
            <Badge>{manifest.meta.name}</Badge>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-stone-900">
              Viết câu chuyện của hai người
            </h1>
            <p className="mt-3 text-sm leading-6 text-stone-600">
              Mọi thay đổi được tự động lưu. Bạn có thể đi qua các bước theo thứ tự bất kỳ.
            </p>
            <div className="mt-8">
              <DraftEditor
                analytics={result.data.analytics}
                audioTracks={audioCatalog.listSelectableTracks()}
                gift={draft}
                manifest={manifest}
                publishable={isTemplateVersionAvailable(draft.templateId, draft.templateVersion)}
                publishEnabled={getInternalPublishEnvironment().enabled}
                signedIn={context.userId !== null}
              />
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-rose-100 bg-white/80 p-5">
              <p className="text-xs font-bold tracking-wider text-stone-500 uppercase">
                Quyền sở hữu
              </p>
              <p className="mt-2 text-sm leading-6 text-stone-700">
                {draft.ownerKind === "user"
                  ? "Bản nháp đã được bảo vệ bởi tài khoản của bạn."
                  : "Bản nháp đang được bảo vệ bằng cookie bí mật trên trình duyệt này."}
              </p>
              <div className="mt-4">
                {draft.ownerKind === "anonymous" ? (
                  context.userId ? (
                    <ClaimDraftButton publicId={publicId} />
                  ) : (
                    <Link
                      className={buttonVariants({ variant: "outline" })}
                      href={{
                        pathname: ROUTES.authSignIn,
                        query: { next: `/studio/${publicId}` },
                      }}
                    >
                      Đăng nhập để lưu lâu dài
                    </Link>
                  )
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      </Container>
    </main>
  );
}
