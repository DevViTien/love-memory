import { z } from "zod";

import { type JobHandler, JobFailure, type JobType } from "@/modules/jobs/application/job-registry";

/** One system email to a gift's owner (`system-emails` "System email job"). */
export const SYSTEM_EMAIL_JOB: JobType = "email.send.v1";

export const SYSTEM_EMAIL_KINDS = [
  "gift_published",
  "photo_processing_failed",
  "gift_taken_down",
  "payment_received",
] as const;

export type SystemEmailKind = (typeof SYSTEM_EMAIL_KINDS)[number];

const SystemEmailPayloadSchema = z
  .object({
    eventKey: z.string().min(1).max(64),
    giftId: z.uuid(),
    kind: z.enum(SYSTEM_EMAIL_KINDS),
  })
  .strict();

export type SystemEmailPayload = z.infer<typeof SystemEmailPayloadSchema>;

/** The deduplication key, which is also the provider's idempotency key for the send. */
export function systemEmailKey({ eventKey, giftId, kind }: SystemEmailPayload): string {
  return `${SYSTEM_EMAIL_JOB}:${kind}:${giftId}:${eventKey}`;
}

/** What `enqueueJob` needs for one system email, inside the transaction of its event. */
export function systemEmailJob(payload: SystemEmailPayload, now: Date) {
  return {
    deduplicationKey: systemEmailKey(payload),
    now,
    payload: { ...payload },
    type: SYSTEM_EMAIL_JOB,
  };
}

export type ComposedEmail = Readonly<{ html: string; subject: string; text: string }>;

type Copy = Readonly<{ action: string; lines: readonly string[]; subject: string }>;

const COPY: Readonly<Record<SystemEmailKind, Copy>> = {
  gift_published: {
    action: "Mở trang quản lý món quà",
    lines: [
      "Món quà của bạn đã được đăng và sẵn sàng để gửi cho người nhận.",
      "Bạn có thể quản lý, tạm dừng hoặc xoá món quà từ trang của nó.",
    ],
    subject: "Món quà của bạn đã sẵn sàng để gửi",
  },
  gift_taken_down: {
    action: "Mở trang quản lý món quà",
    lines: [
      "Món quà của bạn đã bị tạm khoá sau một báo cáo về nội dung.",
      "Người nhận hiện không thể mở món quà. Bạn vẫn có thể xoá món quà từ trang của nó.",
    ],
    subject: "Món quà của bạn đã bị tạm khoá",
  },
  payment_received: {
    action: "Mở trang quản lý món quà",
    lines: [
      "Chúng tôi đã nhận thanh toán cho món quà của bạn.",
      "Món quà sẽ được xuất bản ngay. Nếu nội dung cần sửa thêm, hãy mở trang của món quà để hoàn tất.",
    ],
    subject: "Đã nhận thanh toán cho món quà của bạn",
  },
  photo_processing_failed: {
    action: "Mở món quà để thử lại",
    lines: [
      "Một ảnh trong món quà của bạn chưa xử lý được.",
      "Hãy mở trang của món quà để thử lại hoặc thay ảnh khác.",
    ],
    subject: "Một ảnh trong món quà chưa xử lý được",
  },
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}

/**
 * The email of one kind (`system-emails` "Email kinds and content"). It takes only the Studio
 * link, so no gift content, share link, price or report detail can ever reach it.
 */
export function composeSystemEmail(kind: SystemEmailKind, studioUrl: string): ComposedEmail {
  const copy = COPY[kind];
  const url = escapeHtml(studioUrl);
  return {
    html: `${copy.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}<p><a href="${url}">${escapeHtml(copy.action)}</a></p>`,
    subject: copy.subject,
    text: `${copy.lines.join("\n")}\n\n${copy.action}: ${studioUrl}`,
  };
}

export type OutgoingEmail = ComposedEmail &
  Readonly<{ idempotencyKey: string; kind: SystemEmailKind; to: string }>;

export interface EmailSender {
  /** Sends one email; throws when the provider refuses it. */
  send(email: OutgoingEmail): Promise<void>;
}

/** The gift and its owner's address, read when the job runs. */
export type SystemEmailRecipient = Readonly<{ email: string | null; publicId: string }>;

export interface SystemEmailRecipients {
  /** `null` for a gift that no longer exists, is being deleted, or has no signed-in owner. */
  findForGift(giftId: string): Promise<SystemEmailRecipient | null>;
}

type Dependencies = Readonly<{
  appUrl: () => URL;
  recipients: SystemEmailRecipients;
  sender: () => EmailSender;
}>;

/** `email.send.v1`: safe to repeat, since the provider deduplicates on the idempotency key. */
export function createSystemEmailHandler({
  appUrl,
  recipients,
  sender,
}: Dependencies): JobHandler<SystemEmailPayload> {
  return {
    maxAttempts: 6,
    payload: SystemEmailPayloadSchema,
    async run(payload) {
      const recipient = await recipients.findForGift(payload.giftId);
      if (!recipient?.email) return;
      const studioUrl = new URL(`/studio/${recipient.publicId}`, appUrl()).toString();
      try {
        await sender().send({
          ...composeSystemEmail(payload.kind, studioUrl),
          idempotencyKey: systemEmailKey(payload),
          kind: payload.kind,
          to: recipient.email,
        });
      } catch {
        // The provider's message may echo the address: report the code only.
        throw new JobFailure("EMAIL_SEND_FAILED", true);
      }
    },
    type: SYSTEM_EMAIL_JOB,
  };
}
