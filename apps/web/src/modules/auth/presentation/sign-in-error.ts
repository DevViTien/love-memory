// Better Auth appends its own `error` code to the error callback URL, overwriting any value the form
// supplied, so every non-empty code must map to a message. Provider codes and descriptions are never
// rendered verbatim.
const INVALID_LINK_ERRORS = new Set(["invalid-link", "INVALID_TOKEN"]);

export const SIGN_IN_ERROR_MESSAGES = {
  failed: "Chưa thể hoàn tất đăng nhập. Vui lòng thử lại hoặc yêu cầu liên kết mới.",
  invalidLink:
    "Liên kết đăng nhập không hợp lệ, đã hết hạn hoặc đã được sử dụng. Vui lòng yêu cầu liên kết mới.",
} as const;

export function signInErrorMessage(error: string | string[] | undefined): string | null {
  const value = Array.isArray(error) ? error[0] : error;
  if (!value) return null;
  return INVALID_LINK_ERRORS.has(value)
    ? SIGN_IN_ERROR_MESSAGES.invalidLink
    : SIGN_IN_ERROR_MESSAGES.failed;
}
