import { ROUTES } from "@love-memory/shared";
import { Badge, buttonVariants, Container } from "@love-memory/ui";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getGiftTemplateManifest, giftService } from "@/composition/gifts";
import { ClaimDraftButton } from "@/modules/gifts/presentation/claim-draft-button";
import { DraftEditor } from "@/modules/gifts/presentation/draft-editor";
import { getGiftRequestContext } from "@/modules/gifts/presentation/gift-route-helpers";

type StudioDraftPageProps = Readonly<{
  params: Promise<{ publicId: string }>;
}>;

const steps = ["Nội dung", "Ảnh & âm thanh", "Xem trước", "Xuất bản"] as const;

export const dynamic = "force-dynamic";

export default async function StudioDraftPage({ params }: StudioDraftPageProps) {
  const publicId = (await params).publicId;
  const requestHeaders = await headers();
  const context = await getGiftRequestContext(
    new Request("http://love-memory.local/studio", { headers: requestHeaders }),
  );

  const result = await giftService.getDraft({ accessors: context.accessors, publicId });

  if (!result.ok) {
    notFound();
  }

  const manifest = await getGiftTemplateManifest(
    result.data.templateId,
    result.data.templateVersion,
  );
  if (!manifest) {
    throw new Error("Gift template version is unavailable.");
  }

  return (
    <main>
      <Container className="py-10 sm:py-14">
        <nav aria-label="Các bước tạo quà" className="mb-8 overflow-x-auto">
          <ol className="flex min-w-max gap-2">
            {steps.map((step, index) => (
              <li
                className={
                  index === 0
                    ? "rounded-full bg-rose-600 px-4 py-2 text-sm font-bold text-white"
                    : "rounded-full bg-white px-4 py-2 text-sm font-semibold text-stone-500"
                }
                key={step}
              >
                {index + 1}. {step}
              </li>
            ))}
          </ol>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
          <section className="rounded-[2rem] border border-rose-100 bg-white/90 p-6 shadow-lg shadow-rose-100/50 sm:p-9">
            <Badge>{manifest.meta.name}</Badge>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-stone-900">
              Viết câu chuyện của hai người
            </h1>
            <p className="mt-3 text-sm leading-6 text-stone-600">
              Bản nháp tự bảo vệ bằng revision. Nếu một tab khác lưu trước, hệ thống sẽ yêu cầu tải
              lại thay vì ghi đè nội dung.
            </p>
            <div className="mt-8">
              <DraftEditor gift={result.data} manifest={manifest} />
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-rose-100 bg-white/80 p-5">
              <p className="text-xs font-bold tracking-wider text-stone-500 uppercase">
                Quyền sở hữu
              </p>
              <p className="mt-2 text-sm leading-6 text-stone-700">
                {result.data.ownerKind === "user"
                  ? "Bản nháp đã được bảo vệ bởi tài khoản của bạn."
                  : "Bản nháp đang được bảo vệ bằng cookie bí mật trên trình duyệt này."}
              </p>
              <div className="mt-4">
                {result.data.ownerKind === "anonymous" ? (
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
