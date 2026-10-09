import { describe, expect, it, vi } from "vitest";

import { createCaptureEmailSender, createProviderEmailSender } from "./email-sender";

const email = {
  html: "<p>Xin chào</p>",
  idempotencyKey: "email.send.v1:gift_published:gift-1:first",
  kind: "gift_published",
  subject: "Món quà của bạn đã sẵn sàng để gửi",
  text: "Xin chào",
  to: "owner@example.test",
} as const;

describe("system email senders", () => {
  it("sends through the provider with the idempotency key", async () => {
    const send = vi.fn(() => Promise.resolve({ data: { id: "e-1" }, error: null }));
    await createProviderEmailSender(
      { emails: { send } },
      "LoveMemory <no-reply@example.test>",
    ).send(email);

    expect(send).toHaveBeenCalledWith(
      {
        from: "LoveMemory <no-reply@example.test>",
        html: email.html,
        subject: email.subject,
        text: email.text,
        to: email.to,
      },
      { idempotencyKey: email.idempotencyKey },
    );
  });

  it("throws without the provider's message, which may echo the address", async () => {
    const send = vi.fn(() =>
      Promise.resolve({ data: null, error: { message: "owner@example.test is invalid" } }),
    );
    const failure = await createProviderEmailSender({ emails: { send } }, "a@example.test")
      .send(email)
      .catch((error: unknown) => error as Error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).not.toContain("owner@example.test");
  });

  it("captures one JSON line with the kind, address, subject and text (E2E capture)", async () => {
    const writer = vi.fn(() => Promise.resolve());
    await createCaptureEmailSender("/tmp/emails.jsonl", writer).send(email);

    expect(writer).toHaveBeenCalledWith(
      "/tmp/emails.jsonl",
      JSON.stringify({
        kind: email.kind,
        subject: email.subject,
        text: email.text,
        to: email.to,
      }),
    );
  });
});
