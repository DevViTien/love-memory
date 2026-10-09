import { describe, expect, it, vi } from "vitest";

import { JobFailure } from "@/modules/jobs/application/job-registry";

import {
  composeSystemEmail,
  createSystemEmailHandler,
  type EmailSender,
  SYSTEM_EMAIL_KINDS,
  systemEmailJob,
  type SystemEmailRecipients,
} from "./system-emails";

const giftId = "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89";
const now = new Date("2026-10-10T10:00:00.000Z");
const context = { jobId: "job-1", now };

function handlerWith(
  recipient: Awaited<ReturnType<SystemEmailRecipients["findForGift"]>>,
  send: EmailSender["send"] = vi.fn(() => Promise.resolve()),
) {
  const findForGift = vi.fn<SystemEmailRecipients["findForGift"]>(() => Promise.resolve(recipient));
  const handler = createSystemEmailHandler({
    appUrl: () => new URL("https://lovememory.example"),
    recipients: { findForGift },
    sender: () => ({ send }),
  });
  return { findForGift, handler, send };
}

describe("system emails", () => {
  it("builds the job of one event: identifiers only, keyed by kind, gift and event", () => {
    expect(systemEmailJob({ eventKey: "first", giftId, kind: "gift_published" }, now)).toEqual({
      deduplicationKey: `email.send.v1:gift_published:${giftId}:first`,
      now,
      payload: { eventKey: "first", giftId, kind: "gift_published" },
      type: "email.send.v1",
    });
  });

  it("composes each kind in Vietnamese with the Studio link only (Published email holds no content)", () => {
    const studioUrl = "https://lovememory.example/studio/pub-1";
    const subjects = SYSTEM_EMAIL_KINDS.map((kind) => {
      const email = composeSystemEmail(kind, studioUrl);
      expect(email.text).toContain(studioUrl);
      expect(email.html).toContain(`href="${studioUrl}"`);
      expect(email.text).not.toContain("/g/");
      return email.subject;
    });
    expect(subjects).toEqual([
      "Món quà của bạn đã sẵn sàng để gửi",
      "Một ảnh trong món quà chưa xử lý được",
      "Món quà của bạn đã bị tạm khoá",
    ]);
  });

  it("escapes the link in the HTML body", () => {
    const email = composeSystemEmail("gift_published", 'https://x.example/studio/a"<b>&');
    expect(email.html).toContain('href="https://x.example/studio/a&quot;&lt;b>&amp;"');
  });

  it("sends one email to the current owner, keyed for the provider (Email to the owner)", async () => {
    const { findForGift, handler, send } = handlerWith({
      email: "owner@example.test",
      publicId: "pub-1",
    });

    await handler.run({ eventKey: "first", giftId, kind: "gift_published" }, context);

    expect(findForGift).toHaveBeenCalledWith(giftId);
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        idempotencyKey: `email.send.v1:gift_published:${giftId}:first`,
        kind: "gift_published",
        subject: "Món quà của bạn đã sẵn sàng để gửi",
        text: expect.stringContaining("https://lovememory.example/studio/pub-1") as string,
        to: "owner@example.test",
      }),
    );
    expect(handler).toMatchObject({ maxAttempts: 6, type: "email.send.v1" });
  });

  it("completes without sending for a gone gift or an owner without an address (Deleted gift skipped)", async () => {
    for (const recipient of [null, { email: null, publicId: "pub-1" }]) {
      const { handler, send } = handlerWith(recipient);
      await expect(
        handler.run({ eventKey: "first", giftId, kind: "gift_published" }, context),
      ).resolves.toBeUndefined();
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("retries a provider failure with the same key (Provider failure retried once delivered)", async () => {
    const send = vi
      .fn<EmailSender["send"]>()
      .mockRejectedValueOnce(new Error("owner@example.test refused"))
      .mockResolvedValueOnce();
    const { handler } = handlerWith({ email: "owner@example.test", publicId: "pub-1" }, send);
    const payload = { eventKey: "asset-1", giftId, kind: "photo_processing_failed" } as const;

    const failure = await handler.run(payload, context).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JobFailure);
    expect(failure).toMatchObject({ code: "EMAIL_SEND_FAILED", retryable: true });
    expect(String((failure as Error).message)).not.toContain("owner@example.test");

    await handler.run(payload, context);
    const keys = send.mock.calls.map(([email]) => email.idempotencyKey);
    expect(keys).toEqual([
      `email.send.v1:photo_processing_failed:${giftId}:asset-1`,
      `email.send.v1:photo_processing_failed:${giftId}:asset-1`,
    ]);
  });

  it("accepts identifiers only in its payload", () => {
    const { handler } = handlerWith(null);
    expect(
      handler.payload.safeParse({ eventKey: "first", giftId, kind: "gift_published" }).success,
    ).toBe(true);
    expect(
      handler.payload.safeParse({
        email: "owner@example.test",
        eventKey: "first",
        giftId,
        kind: "gift_published",
      }).success,
    ).toBe(false);
    expect(
      handler.payload.safeParse({ eventKey: "first", giftId, kind: "payment_received" }).success,
    ).toBe(false);
  });
});
