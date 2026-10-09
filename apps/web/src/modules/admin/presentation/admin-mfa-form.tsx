"use client";

import { Button } from "@love-memory/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type Setup = Readonly<{ backupCodes: readonly string[]; setupKey: string; totpUri: string }>;

type SetupResponse = Readonly<{ data?: Setup }>;
type ErrorResponse = Readonly<{ error?: { details?: { retryAfterSeconds?: number } } }>;

export const ADMIN_MFA_BACKUP_NOTE =
  "Lưu các mã dự phòng ở nơi an toàn. Mỗi mã chỉ dùng được một lần.";

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function minutesOf(seconds: number | undefined): number {
  return Math.max(1, Math.ceil((seconds ?? 60) / 60));
}

/**
 * `/admin/mfa` (`admin-access`): for an admin without a factor, an enrollment step that shows the
 * setup key, the URI and the backup codes once; then, for every admin, the code form.
 */
export function AdminMfaForm({
  enrolled,
  onVerified,
}: Readonly<{ enrolled: boolean; onVerified?: () => void }>) {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [setupState, setSetupState] = useState<"error" | "idle" | "pending">("idle");
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyEnrolled, setAlreadyEnrolled] = useState(enrolled);

  async function requestSetup() {
    setSetupState("pending");
    try {
      const response = await postJson("/api/admin/mfa/enroll", {});
      if (response.status === 409) {
        setAlreadyEnrolled(true);
        setSetupState("idle");
        return;
      }
      const body = (await response.json()) as SetupResponse;
      if (!response.ok || !body.data) throw new Error("SETUP_FAILED");
      setSetup(body.data);
      setSetupState("idle");
    } catch {
      setSetupState("error");
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsVerifying(true);
    setError(null);
    try {
      const response = await postJson("/api/admin/mfa/verify", { code: code.trim() });
      if (response.ok) {
        // The browser already holds the cookie of a session the first code may have replaced.
        if (onVerified) onVerified();
        else router.replace("/admin");
        return;
      }
      if (response.status === 400) {
        setError("Mã không đúng. Vui lòng thử lại.");
      } else if (response.status === 429) {
        const body = (await response.json()) as ErrorResponse;
        const minutes = minutesOf(body.error?.details?.retryAfterSeconds);
        setError(`Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ${minutes} phút.`);
      } else {
        setError("Chưa thể xác thực lúc này. Vui lòng thử lại.");
      }
    } catch {
      setError("Chưa thể xác thực lúc này. Vui lòng thử lại.");
    } finally {
      setIsVerifying(false);
    }
  }

  const needsSetup = !alreadyEnrolled && setup === null;

  return (
    <div className="space-y-6">
      {needsSetup ? (
        <section className="space-y-4">
          <p className="leading-7 text-stone-600">
            Tài khoản quản trị cần một ứng dụng xác thực (Google Authenticator, Microsoft
            Authenticator, 1Password…). Tạo mã thiết lập để bắt đầu.
          </p>
          {setupState === "error" ? (
            <p aria-live="polite" className="text-sm font-semibold text-red-700" role="alert">
              Chưa thể tạo mã thiết lập. Vui lòng thử lại.
            </p>
          ) : null}
          <Button
            disabled={setupState === "pending"}
            onClick={() => void requestSetup()}
            type="button"
          >
            {setupState === "pending" ? "Đang tạo…" : "Tạo mã thiết lập"}
          </Button>
        </section>
      ) : null}

      {setup ? (
        <section aria-label="Thiết lập ứng dụng xác thực" className="space-y-4">
          <div>
            <p className="text-sm font-bold text-stone-800">Mã thiết lập</p>
            <p className="mt-1 font-mono text-lg font-bold break-all text-stone-900">
              {setup.setupKey}
            </p>
          </div>
          <div>
            <p className="text-sm font-bold text-stone-800">Liên kết thiết lập</p>
            <p className="mt-1 font-mono text-xs break-all text-stone-600">{setup.totpUri}</p>
          </div>
          <div className="rounded-2xl bg-amber-50 p-4 text-amber-950">
            <p className="text-sm font-bold">Mã dự phòng</p>
            <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
              {setup.backupCodes.map((backupCode) => (
                <li key={backupCode}>{backupCode}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm font-semibold">{ADMIN_MFA_BACKUP_NOTE}</p>
          </div>
        </section>
      ) : null}

      {needsSetup ? null : (
        <form className="space-y-4" onSubmit={(event) => void handleVerify(event)}>
          <div>
            <label className="text-sm font-bold text-stone-800" htmlFor="admin-mfa-code">
              Mã xác thực
            </label>
            <input
              autoComplete="one-time-code"
              className="mt-2 h-12 w-full rounded-2xl border border-rose-200 bg-white px-4 font-mono text-stone-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
              id="admin-mfa-code"
              maxLength={32}
              name="code"
              onChange={(event) => setCode(event.target.value)}
              required
              spellCheck={false}
              value={code}
            />
            <p className="mt-2 text-xs leading-5 text-stone-500">
              Nhập mã 6 số trong ứng dụng xác thực, hoặc một mã dự phòng.
            </p>
          </div>
          {error ? (
            <p aria-live="polite" className="text-sm font-semibold text-red-700" role="alert">
              {error}
            </p>
          ) : null}
          <Button disabled={isVerifying} type="submit">
            {isVerifying ? "Đang xác thực…" : "Xác nhận"}
          </Button>
        </form>
      )}
    </div>
  );
}
