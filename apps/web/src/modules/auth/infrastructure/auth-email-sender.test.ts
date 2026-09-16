import { describe, expect, it, vi } from "vitest";

import { createAuthEmailSender, createCaptureAuthEmailSender } from "./auth-email-sender";

describe("auth email sender", () => {
  it("sends a one-time login link without logging it", async () => {
    const send = vi.fn(() => Promise.resolve({ data: { id: "mail-1" }, error: null }));
    const sender = createAuthEmailSender({ emails: { send } }, "hello@example.com");

    await sender.sendMagicLink({
      email: "creator@example.com",
      url: "https://love.example.com/api/auth/magic-link/verify?token=secret",
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Liên kết đăng nhập LoveMemory",
        to: "creator@example.com",
      }),
    );
  });

  it("fails closed when the provider rejects delivery", async () => {
    const sender = createAuthEmailSender(
      {
        emails: {
          send: () => Promise.resolve({ data: null, error: { message: "provider unavailable" } }),
        },
      },
      "hello@example.com",
    );

    await expect(
      sender.sendMagicLink({ email: "creator@example.com", url: "https://example.com/token" }),
    ).rejects.toThrow("provider unavailable");
  });

  it("captures magic links through an injected loopback test writer", async () => {
    const writer = vi.fn(() => Promise.resolve());
    const sender = createCaptureAuthEmailSender(".tmp/auth.jsonl", writer);
    const message = { email: "creator@example.com", url: "http://127.0.0.1/magic-link" };

    await sender.sendMagicLink(message);

    expect(writer).toHaveBeenCalledWith(".tmp/auth.jsonl", message);
  });
});
