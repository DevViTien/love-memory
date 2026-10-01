"use client";

import { ROUTES } from "@love-memory/shared";
import { Button, buttonVariants } from "@love-memory/ui";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { ClaimDraftButton } from "../claim-draft-button";
import { reloadStudioPage, requestPublish } from "./publish-action";
import { studioLinkHandler, useStudio } from "./studio-context";

type Notice =
  | Readonly<{ kind: "message"; text: string }>
  | Readonly<{ fieldIds: readonly string[]; kind: "rejected" }>
  | Readonly<{ kind: "sign-in-again" }>;

const MESSAGES = {
  accessUnsupported: "Chế độ truy cập của món quà này chưa hỗ trợ xuất bản.",
  anonymous: "Đăng nhập và lưu quà vào tài khoản để xuất bản.",
  failed: "Chưa xuất bản được — thử lại.",
  incomplete: "Hoàn thiện các bước còn thiếu để xuất bản.",
  notEnabled: "Xuất bản chưa được mở cho tài khoản này.",
  rejected: "Chưa xuất bản được: một số nội dung chưa sẵn sàng.",
  sessionExpired: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để xuất bản.",
  unpublishable: "Phiên bản mẫu của món quà này không hỗ trợ xuất bản.",
} as const;

function signInHref(publicId: string) {
  return { pathname: ROUTES.authSignIn, query: { next: `/studio/${publicId}` } };
}

/**
 * The `Xuất bản` action: disabled with one explanation until the template version can be
 * published, the draft is claimed, publishing is enabled and every step is complete. It asks for a
 * confirmation first. `Xác nhận xuất bản` freezes the editor, settles pending saves, publishes the
 * last saved revision with one `Idempotency-Key` per page, and hands the publication to the editor
 * on success.
 */
export function PublishStep({ incomplete }: Readonly<{ incomplete: boolean }>) {
  const { controller, navigation, publish, report, store } = useStudio();
  const publicId = store.getState().context.publicId;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // Created on the first attempt and reused by every retry of this page.
  const idempotencyKey = useRef<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const confirmHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (confirming) confirmHeading.current?.focus();
  }, [confirming]);

  let blocked: ReactNode = null;
  if (!publish.publishable) {
    blocked = <p className="text-sm font-semibold text-stone-600">{MESSAGES.unpublishable}</p>;
  } else if (publish.ownerKind === "anonymous") {
    blocked = (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-stone-600">{MESSAGES.anonymous}</p>
        {publish.signedIn ? (
          <ClaimDraftButton publicId={publicId} />
        ) : (
          <Link className={buttonVariants({ variant: "outline" })} href={signInHref(publicId)}>
            Đăng nhập để xuất bản
          </Link>
        )}
      </div>
    );
  } else if (!publish.enabled) {
    blocked = <p className="text-sm font-semibold text-stone-600">{MESSAGES.notEnabled}</p>;
  } else if (incomplete) {
    blocked = <p className="text-sm font-semibold text-stone-600">{MESSAGES.incomplete}</p>;
  }

  /** `Xuất bản`: counted as the publish intent, then the confirmation; no request yet. */
  function askToConfirm() {
    if (blocked !== null || busyRef.current || confirming) return;
    report("publish_clicked");
    setNotice(null);
    setConfirming(true);
  }

  async function startPublish() {
    // A ref, not only state: a second click in the same frame must not send a second request.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    idempotencyKey.current ??= crypto.randomUUID();
    // Nothing on screen may change while the request runs: what is shown is what is published.
    store.getState().setPublishing(true);
    const outcome = await requestPublish({
      flush: () => controller.flush(),
      idempotencyKey: idempotencyKey.current,
      publicId,
    });
    const state = store.getState();
    if (outcome.kind !== "published") state.setPublishing(false);
    switch (outcome.kind) {
      case "published":
        // No autosave or draft request may follow for a published gift.
        controller.dispose();
        publish.onPublished(outcome.publication);
        return;
      case "reload":
        reloadStudioPage();
        return;
      case "invalid": {
        state.applyServerFieldErrors(outcome.fieldErrors);
        const known = new Set(state.context.manifest.fields.map((field) => field.id));
        const fieldIds = [
          ...new Set(Object.keys(outcome.fieldErrors).map((key) => key.split(".")[0] ?? "")),
        ].filter((fieldId) => known.has(fieldId));
        setNotice({ fieldIds, kind: "rejected" });
        break;
      }
      case "unauthenticated":
        setNotice({ kind: "sign-in-again" });
        break;
      case "forbidden":
        setNotice({ kind: "message", text: MESSAGES.notEnabled });
        break;
      case "gone":
        // The same non-editable path as a 404 save: the alert shows and autosave stops.
        state.applyOutcome({ kind: "gone" }, state.content);
        break;
      case "conflict":
        state.applyOutcome(
          { actualRevision: outcome.actualRevision, kind: "conflict" },
          state.content,
        );
        break;
      case "unpublishable":
        setNotice({ kind: "message", text: MESSAGES.unpublishable });
        break;
      case "access-unsupported":
        setNotice({ kind: "message", text: MESSAGES.accessUnsupported });
        break;
      case "rate-limited":
        setNotice({
          kind: "message",
          text: `Bạn thử xuất bản quá nhiều lần. Hãy thử lại sau ${outcome.retryAfterSeconds ?? 60} giây.`,
        });
        break;
      case "failed":
        setNotice({ kind: "message", text: MESSAGES.failed });
        break;
      case "blocked":
        break;
    }
    busyRef.current = false;
    setBusy(false);
    setConfirming(false);
  }

  const fieldLabel = (fieldId: string) =>
    store.getState().context.manifest.fields.find((field) => field.id === fieldId)?.label ??
    fieldId;

  return (
    <div className="space-y-3">
      {confirming ? (
        <div className="space-y-4 rounded-3xl border border-rose-200 bg-rose-50/60 p-5">
          <h3
            className="text-lg font-black text-stone-900 focus:outline-none"
            ref={confirmHeading}
            tabIndex={-1}
          >
            Xuất bản món quà này?
          </h3>
          <p className="text-sm leading-6 text-stone-700">
            Sau khi xuất bản, bạn chưa thể chỉnh sửa hay thu hồi món quà. Ai có đường dẫn đều mở
            được món quà.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy} onClick={() => void startPublish()} size="lg">
              {busy ? "Đang xuất bản…" : "Xác nhận xuất bản"}
            </Button>
            <Button disabled={busy} onClick={() => setConfirming(false)} variant="outline">
              Quay lại chỉnh sửa
            </Button>
          </div>
        </div>
      ) : (
        <Button disabled={blocked !== null || busy} onClick={askToConfirm} size="lg">
          Xuất bản
        </Button>
      )}
      {blocked ?? (
        <p className="text-sm text-stone-600">
          Sau khi xuất bản, bạn không thể chỉnh sửa món quà này.
        </p>
      )}
      {notice?.kind === "message" ? (
        <p className="text-sm font-semibold text-rose-700" role="alert">
          {notice.text}
        </p>
      ) : null}
      {notice?.kind === "sign-in-again" ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm font-semibold text-rose-700">{MESSAGES.sessionExpired}</p>
          <Link className="font-bold text-rose-700 underline" href={signInHref(publicId)}>
            Đăng nhập lại
          </Link>
        </div>
      ) : null}
      {notice?.kind === "rejected" ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm font-semibold text-rose-700">{MESSAGES.rejected}</p>
          <ul className="space-y-2">
            {notice.fieldIds.map((fieldId) => (
              <li
                className="flex items-center justify-between gap-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-stone-800"
                key={fieldId}
              >
                <span>{fieldLabel(fieldId)}</span>
                <a
                  className="font-bold text-rose-700 underline"
                  href={`/studio/${publicId}?field=${encodeURIComponent(fieldId)}`}
                  onClick={studioLinkHandler(() => navigation.openField(fieldId))}
                >
                  Sửa
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
