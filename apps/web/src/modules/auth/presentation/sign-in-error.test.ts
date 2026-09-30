import { describe, expect, it } from "vitest";

import { SIGN_IN_ERROR_MESSAGES, signInErrorMessage } from "./sign-in-error";

describe("signInErrorMessage", () => {
  it.each(["invalid-link", "INVALID_TOKEN", ["INVALID_TOKEN", "other"]])(
    "explains an invalid, expired or reused link for %s",
    (error) => {
      expect(signInErrorMessage(error)).toBe(SIGN_IN_ERROR_MESSAGES.invalidLink);
    },
  );

  it("shows a generic message for other provider errors without echoing them", () => {
    const message = signInErrorMessage("failed_to_create_session");

    expect(message).toBe(SIGN_IN_ERROR_MESSAGES.failed);
    expect(message).not.toContain("failed_to_create_session");
  });

  it.each([undefined, "", []])("shows nothing without an error (%s)", (error) => {
    expect(signInErrorMessage(error)).toBeNull();
  });
});
