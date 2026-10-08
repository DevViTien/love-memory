"use client";

import { ROUTES } from "@love-memory/shared";
import { Button, buttonVariants } from "@love-memory/ui";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { ClaimDraftButton } from "../claim-draft-button";
import { selectCanUpdatePublication } from "./draft-editor-store";
import { reloadStudioPage, requestPublish } from "./publish-action";
import { studioLinkHandler, useStudio } from "./studio-context";

type Notice =
  | Readonly<{ kind: "message"; text: string }>
  | Readonly<{ fieldIds: readonly string[]; kind: "rejected" }>
  | Readonly<{ kind: "sign-in-again" }>
  | Readonly<{ kind: "updated" }>;

const MESSAGES = {
  accessUnsupported: "Chế độ truy cập của món quà này chưa hỗ trợ xuất bản.",
  anonymous: "Đăng nhập và lưu quà vào tài khoản để xuất bản.",
  notEnabled: "Xuất bản chưa được mở cho tài khoản này.",
  sessionExpired: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để xuất bản.",
  unpublishable: "Phiên bản mẫu của món quà này không hỗ trợ xuất bản.",
} as const;

/** The texts that differ between a first publish and an update of a published gift. */
const MODE_TEXTS = {
  publish: {
    action: "Xuất bản",
    busy: "Đang xuất bản…",
    confirm: "Xác nhận xuất bản",
    confirmHeading: "Xuất bản món quà này?",
    confirmText:
      "Ai có đường dẫn đều mở được món quà. Bạn có thể chỉnh sửa và cập nhật sau, nhưng chưa thể thu hồi đường dẫn.",
    failed: "Chưa xuất bản được — thử lại.",
    incomplete: "Hoàn thiện các bước còn thiếu để xuất bản.",
    note: "Sau khi xuất bản, bạn vẫn có thể chỉnh sửa và cập nhật món quà tại cùng đường dẫn.",
    rateLimited: (seconds: number) =>
      `Bạn thử xuất bản quá nhiều lần. Hãy thử lại sau ${seconds} giây.`,
    rejected: "Chưa xuất bản được: một số nội dung chưa sẵn sàng.",
  },
  update: {
    action: "Cập nhật món quà",
    busy: "Đang cập nhật…",
    confirm: "Xác nhận cập nhật",
    confirmHeading: "Cập nhật món quà đã gửi?",
    confirmText:
      "Người nhận sẽ thấy nội dung mới ngay tại đường dẫn hiện tại. Bản đã gửi trước đó sẽ không còn hiển thị.",
    failed: "Chưa cập nhật được — thử lại.",
    incomplete: "Hoàn thiện các bước còn thiếu để cập nhật.",
    note: "Người nhận sẽ thấy nội dung mới tại đường dẫn hiện tại.",
    rateLimited: (seconds: number) =>
      `Bạn thử cập nhật quá nhiều lần. Hãy thử lại sau ${seconds} giây.`,
    rejected: "Chưa cập nhật được: một số nội dung chưa sẵn sàng.",
  },
} as const;

const NOTHING_TO_UPDATE = "Người nhận đang xem bản mới nhất. Hãy chỉnh sửa trước khi cập nhật.";

function signInHref(publicId: string) {
  return { pathname: ROUTES.authSignIn, query: { next: `/studio/${publicId}` } };
}

/**
 * The `Xuất bản` action of a draft, or `Cập nhật món quà` of a published gift: disabled with one
 * explanation until the template version can be published, the draft is claimed, publishing is
 * enabled, every step is complete and (for an update) something changed. It asks for a
 * confirmation first. Confirming freezes the editor, settles pending saves and publishes the last
 * saved revision. One `Idempotency-Key` serves every attempt until a `201`; the next publish of
 * the page uses a new one.
 */
export function PublishStep({ incomplete }: Readonly<{ incomplete: boolean }>) {
  const { controller, navigation, publish, report, store } = useStudio();
  const publicId = store.getState().context.publicId;
  const mode = useStore(store, (state) => (state.publication ? "update" : "publish"));
  const canUpdate = useStore(store, selectCanUpdatePublication);
  const texts = MODE_TEXTS[mode];
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // Created on the first attempt and reused by every retry until one succeeds.
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
  } else if (mode === "publish" && publish.ownerKind === "anonymous") {
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
    blocked = <p className="text-sm font-semibold text-stone-600">{texts.incomplete}</p>;
  } else if (mode === "update" && !canUpdate) {
    blocked = <p className="text-sm font-semibold text-stone-600">{NOTHING_TO_UPDATE}</p>;
  }

  /** The action: counted as the publish intent (first publish only), then the confirmation. */
  function askToConfirm() {
    if (blocked !== null || busyRef.current || confirming) return;
    if (mode === "publish") report("publish_clicked");
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
    state.setPublishing(false);
    switch (outcome.kind) {
      case "published": {
        const { publishedAt, revision, shareId, sharePath } = outcome.publication;
        state.setPublication({ publishedAt, revision, shareId, sharePath });
        // A recorded key belongs to that revision: the next publish of this page needs a new one.
        idempotencyKey.current = null;
        if (mode === "update") setNotice({ kind: "updated" });
        publish.onPublished(outcome.publication);
        break;
      }
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
        setNotice({ kind: "message", text: texts.rateLimited(outcome.retryAfterSeconds ?? 60) });
        break;
      case "failed":
        setNotice({ kind: "message", text: texts.failed });
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
            {texts.confirmHeading}
          </h3>
          <p className="text-sm leading-6 text-stone-700">{texts.confirmText}</p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy} onClick={() => void startPublish()} size="lg">
              {busy ? texts.busy : texts.confirm}
            </Button>
            <Button disabled={busy} onClick={() => setConfirming(false)} variant="outline">
              Quay lại chỉnh sửa
            </Button>
          </div>
        </div>
      ) : (
        <Button disabled={blocked !== null || busy} onClick={askToConfirm} size="lg">
          {texts.action}
        </Button>
      )}
      {blocked ?? <p className="text-sm text-stone-600">{texts.note}</p>}
      {notice?.kind === "updated" ? (
        <p className="text-sm font-semibold text-emerald-800" role="status">
          Đã cập nhật món quà.
        </p>
      ) : null}
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
          <p className="text-sm font-semibold text-rose-700">{texts.rejected}</p>
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
