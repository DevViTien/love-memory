import { expect, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// The same fallback as `playwright.config.ts`, which passes this path to the web server.
const authCapturePath = resolve(
  process.env["AUTH_EMAIL_CAPTURE_PATH"] || ".tmp/e2e-auth-emails.jsonl",
);

/** A fresh address per Playwright project and run, so parallel projects never share a link. */
export function uniqueE2eEmail(prefix: string, testInfo: TestInfo): string {
  return `${prefix}-${testInfo.project.name}-${Date.now()}@example.test`;
}

/** The newest magic link captured for this address, or `null`. */
export async function capturedMagicLink(email: string): Promise<string | null> {
  const content = await readFile(authCapturePath, "utf8").catch(() => "");
  const messages = content
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Readonly<{ email: string; url: string }>];
      } catch {
        return [];
      }
    });
  return messages.findLast((message) => message.email === email)?.url ?? null;
}

/**
 * Requests a magic link on the sign-in page the browser is on and follows it. The page returns to
 * the sign-in page's `next` target.
 */
export async function signInThroughMagicLink(page: Page, email: string): Promise<void> {
  await page.getByLabel("Email của bạn").fill(email);
  await page.getByRole("button", { name: "Gửi liên kết đăng nhập" }).click();
  await expect(page.getByText("Kiểm tra hộp thư của bạn")).toBeVisible();
  await expect.poll(() => capturedMagicLink(email), { timeout: 15_000 }).not.toBeNull();
  const magicLink = await capturedMagicLink(email);
  if (!magicLink) throw new Error("Passwordless email capture did not contain a magic link.");
  await page.goto(magicLink);
}
