import "server-only";

import { Resend } from "resend";

export type MagicLinkEmail = Readonly<{
  email: string;
  url: string;
}>;

export interface AuthEmailSender {
  sendMagicLink(message: MagicLinkEmail): Promise<void>;
}

type EmailClient = Readonly<{
  emails: Readonly<{
    send(
      input: Readonly<{
        from: string;
        html: string;
        subject: string;
        text: string;
        to: string;
      }>,
    ): Promise<Readonly<{ data: unknown; error: Readonly<{ message: string }> | null }>>;
  }>;
}>;

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}

export function createAuthEmailSender(client: EmailClient, from: string): AuthEmailSender {
  return {
    async sendMagicLink({ email, url }) {
      const safeUrl = escapeHtml(url);
      const { error } = await client.emails.send({
        from,
        html: `<p>Chạm vào nút bên dưới để đăng nhập LoveMemory. Liên kết chỉ dùng được một lần và sẽ hết hạn sau 10 phút.</p><p><a href="${safeUrl}">Đăng nhập LoveMemory</a></p>`,
        subject: "Liên kết đăng nhập LoveMemory",
        text: `Đăng nhập LoveMemory bằng liên kết dùng một lần (hết hạn sau 10 phút): ${url}`,
        to: email,
      });

      if (error) {
        throw new Error(`Auth email delivery failed: ${error.message}`);
      }
    },
  };
}

export function createResendAuthEmailSender(apiKey: string, from: string): AuthEmailSender {
  return createAuthEmailSender(new Resend(apiKey), from);
}
