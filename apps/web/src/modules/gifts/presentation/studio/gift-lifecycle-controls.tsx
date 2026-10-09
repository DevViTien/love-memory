"use client";

import { Button } from "@love-memory/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatExpiry } from "./plan-format";

export const DELETE_CONFIRMATION =
  "Xoá vĩnh viễn món quà này? Người nhận sẽ không mở được nữa, và ảnh cùng nội dung sẽ bị xoá hẳn trong vòng 24 giờ. Không thể hoàn tác.";

export const LIFECYCLE_ERROR = "Chưa thực hiện được — thử lại.";

type LifecycleAction = "delete" | "pause" | "resume";

async function sendLifecycleRequest(publicId: string, action: LifecycleAction): Promise<void> {
  const response = await fetch(`/api/gifts/${encodeURIComponent(publicId)}/${action}`, {
    body: "{}",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("LIFECYCLE_REQUEST_FAILED");
}

/** One lifecycle action: sends it, then lets the server decide what the Studio shows next. */
function useLifecycleAction(publicId: string) {
  const router = useRouter();
  const [pending, setPending] = useState<LifecycleAction | null>(null);
  const [failed, setFailed] = useState(false);

  async function run(action: LifecycleAction, after: () => void) {
    setPending(action);
    setFailed(false);
    try {
      await sendLifecycleRequest(publicId, action);
      after();
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }

  return { failed, pending, router, run } as const;
}

function LifecycleError() {
  return (
    <p className="text-sm font-semibold text-rose-700" role="alert">
      {LIFECYCLE_ERROR}
    </p>
  );
}

/** `Tạm dừng chia sẻ` in the published panel (`gift-lifecycle`). */
export function PauseGiftButton({ publicId }: Readonly<{ publicId: string }>) {
  const { failed, pending, router, run } = useLifecycleAction(publicId);
  return (
    <div className="space-y-2">
      <Button
        disabled={pending !== null}
        onClick={() => void run("pause", () => router.refresh())}
        type="button"
        variant="outline"
      >
        {pending === "pause" ? "Đang tạm dừng…" : "Tạm dừng chia sẻ"}
      </Button>
      {failed ? <LifecycleError /> : null}
    </div>
  );
}

/** `Xoá món quà`, confirmed; a deleted gift has no Studio page, so it leaves for `/studio/deleted`. */
export function DeleteGiftButton({
  confirm = (message: string) => window.confirm(message),
  publicId,
}: Readonly<{ confirm?: (message: string) => boolean; publicId: string }>) {
  const { failed, pending, router, run } = useLifecycleAction(publicId);
  return (
    <div className="space-y-2">
      <Button
        disabled={pending !== null}
        onClick={() => {
          if (!confirm(DELETE_CONFIRMATION)) return;
          void run("delete", () => router.replace("/studio/deleted"));
        }}
        type="button"
        variant="ghost"
      >
        {pending === "delete" ? "Đang xoá…" : "Xoá món quà"}
      </Button>
      {failed ? <LifecycleError /> : null}
    </div>
  );
}

/** The Studio of a paused gift: no editor, only resume (while not expired) and delete. */
export function PausedGiftPanel({
  confirm,
  expired,
  expiresAt,
  publicId,
  takenDown = false,
}: Readonly<{
  confirm?: (message: string) => boolean;
  expired: boolean;
  expiresAt: string;
  publicId: string;
  takenDown?: boolean;
}>) {
  const { failed, pending, router, run } = useLifecycleAction(publicId);
  if (takenDown) {
    // Held by the operations team (`abuse-reports`): the owner may only delete.
    return (
      <section
        aria-labelledby="taken-down-gift-heading"
        className="space-y-4 rounded-3xl border border-red-200 bg-red-50 p-6"
      >
        <h2 className="text-xl font-black text-red-950" id="taken-down-gift-heading">
          Món quà đã bị tạm khoá
        </h2>
        <p className="text-sm leading-6 text-red-950">
          Món quà bị tạm khoá vì có báo cáo vi phạm quy định nội dung. Người nhận không mở được món
          quà. Bạn vẫn có thể xoá món quà.
        </p>
        <DeleteGiftButton publicId={publicId} {...(confirm ? { confirm } : {})} />
      </section>
    );
  }
  return (
    <section
      aria-labelledby="paused-gift-heading"
      className="space-y-4 rounded-3xl border border-amber-200 bg-amber-50 p-6"
    >
      <h2 className="text-xl font-black text-amber-950" id="paused-gift-heading">
        Đã tạm dừng chia sẻ
      </h2>
      <p className="text-sm leading-6 text-amber-950">
        Người nhận đang không mở được món quà. Đường dẫn cũ sẽ hoạt động lại khi bạn tiếp tục chia
        sẻ.
      </p>
      {expired ? (
        <p className="text-sm font-semibold text-amber-950">
          Món quà đã hết hạn nên không thể tiếp tục chia sẻ.
        </p>
      ) : (
        <p className="text-sm text-amber-950">Người nhận mở được đến {formatExpiry(expiresAt)}.</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {expired ? null : (
          <Button
            disabled={pending !== null}
            onClick={() => void run("resume", () => router.refresh())}
            type="button"
          >
            {pending === "resume" ? "Đang mở lại…" : "Tiếp tục chia sẻ"}
          </Button>
        )}
        <DeleteGiftButton publicId={publicId} {...(confirm ? { confirm } : {})} />
      </div>
      {failed ? <LifecycleError /> : null}
    </section>
  );
}
