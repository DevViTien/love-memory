import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError, draftGift, jsonResponse } from "./test/fixtures";
import { patchBodies, renderEditor, setStudioUrl, stubStudioFetch } from "./test/render-editor";

vi.mock("next/navigation", () => import("./test/next-navigation"));

// These tests wait for the real 1.5 s autosave debounce; under a loaded coverage run the default
// 5 s test timeout is too tight.
const REAL_DEBOUNCE_TEST_TIMEOUT_MS = 15_000;

function statusText() {
  return screen.getByRole("status").textContent;
}

function saveNowButton() {
  return screen.getByRole<HTMLButtonElement>("button", { name: "Lưu ngay" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  setStudioUrl();
});

describe("Save status", () => {
  it(
    "shows Đang lưu… from the first keystroke until the autosave succeeds",
    async () => {
      let respond: (response: Response) => void = () => undefined;
      const fetchMock = stubStudioFetch({
        patch: () => new Promise<Response>((resolve) => (respond = resolve)),
      });
      const user = userEvent.setup();
      renderEditor();
      expect(statusText()).toBe("Đã lưu");
      expect(saveNowButton().disabled).toBe(true);

      await user.type(screen.getByRole("textbox", { name: "Tên người nhận" }), "Linh");
      expect(statusText()).toBe("Đang lưu…");
      expect(saveNowButton().disabled).toBe(false);

      await waitFor(() => expect(patchBodies(fetchMock)).toHaveLength(1), { timeout: 5000 });
      expect(statusText()).toBe("Đang lưu…");
      respond(
        jsonResponse({ data: { gift: draftGift({ "receiver-name": "Linh" }, { revision: 1 }) } }),
      );

      await waitFor(() => expect(statusText()).toBe("Đã lưu"));
      expect(patchBodies(fetchMock)).toEqual([
        { content: { "receiver-name": "Linh" }, expectedRevision: 0 },
      ]);
    },
    REAL_DEBOUNCE_TEST_TIMEOUT_MS,
  );

  it("names an invalid field on another step and opens it from the Sửa link", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    renderEditor({ content: { audio: "old-piano" } });

    expect(statusText()).toBe("Chưa lưu được: Nhạc nền chưa hợp lệ Sửa");
    const link = screen.getByRole("link", { name: "Sửa" });
    expect(link.getAttribute("href")).toBe("/studio/q1w2e3r4t5y6u7i8?field=audio");

    await user.click(link);

    expect(window.location.search).toBe("?step=style");
    await waitFor(() => expect(document.activeElement?.id).toBe("studio-field-audio"));
    expect(patchBodies(fetchMock)).toHaveLength(0);
  });

  it(
    "resumes autosave once the only invalid field is fixed",
    async () => {
      const fetchMock = stubStudioFetch();
      const user = userEvent.setup();
      setStudioUrl("?step=style");
      renderEditor({ content: { audio: "old-piano" } });

      await user.selectOptions(screen.getByLabelText("Nhạc nền"), "Không dùng nhạc");

      expect(statusText()).toBe("Đang lưu…");
      await waitFor(() => expect(patchBodies(fetchMock)).toHaveLength(1), { timeout: 5000 });
      expect(patchBodies(fetchMock)[0]?.content).toEqual({});
      await waitFor(() => expect(statusText()).toBe("Đã lưu"));
    },
    REAL_DEBOUNCE_TEST_TIMEOUT_MS,
  );

  it("reports a failed save and keeps the typed content", async () => {
    stubStudioFetch({ patch: () => Promise.reject(new TypeError("Failed to fetch")) });
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getByRole("textbox", { name: "Tên người nhận" }), "Linh");
    await user.click(saveNowButton());

    await waitFor(() => expect(statusText()).toBe("Chưa lưu được — thử lại"));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Tên người nhận" }).value).toBe(
      "Linh",
    );
  });

  it("shows the non-editable alert and disables Lưu ngay when the draft is gone", async () => {
    stubStudioFetch({ patch: () => jsonResponse(apiError("NOT_FOUND"), 404) });
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getByRole("textbox", { name: "Tên người nhận" }), "Linh");
    await user.click(saveNowButton());

    expect(
      await screen.findByText("Bản nháp này không còn chỉnh sửa được. Hãy tải lại trang."),
    ).toBeTruthy();
    expect(saveNowButton().disabled).toBe(true);
  });
});

describe("Conflict banner", () => {
  function conflictThenSaved() {
    let conflicts = 1;
    return stubStudioFetch({
      get: () =>
        jsonResponse({
          data: { gift: draftGift({ "receiver-name": "Tab A" }, { revision: 5 }) },
        }),
      patch: (body) =>
        conflicts-- > 0
          ? jsonResponse(
              apiError("CONFLICT", { details: { actualRevision: 5, expectedRevision: 4 } }),
              409,
            )
          : jsonResponse({
              data: { gift: draftGift(body.content, { revision: body.expectedRevision + 1 }) },
            }),
    });
  }

  async function reachConflict(user: ReturnType<typeof userEvent.setup>) {
    renderEditor({ revision: 4 });
    await user.type(screen.getByRole("textbox", { name: "Tên người nhận" }), "Tab B");
    await user.click(saveNowButton());
    return screen.findByRole("alert");
  }

  it("stops saving and offers the two choices", async () => {
    const fetchMock = conflictThenSaved();
    const user = userEvent.setup();

    const banner = await reachConflict(user);

    expect(banner.textContent).toContain("Bản nháp đã được lưu ở nơi khác (phiên bản 5).");
    expect(screen.getByRole("button", { name: "Tải bản mới nhất" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Giữ bản của tôi" })).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Tên người nhận" }), " ơi");
    expect(saveNowButton().disabled).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Tên người nhận" }).value).toBe(
      "Tab B ơi",
    );
    expect(patchBodies(fetchMock)).toHaveLength(1);
  });

  it("loads the latest version", async () => {
    conflictThenSaved();
    const user = userEvent.setup();
    await reachConflict(user);

    await user.click(screen.getByRole("button", { name: "Tải bản mới nhất" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Tên người nhận" }).value).toBe(
      "Tab A",
    );
    expect(statusText()).toBe("Đã lưu");
  });

  it("keeps my version against the actual revision", async () => {
    const fetchMock = conflictThenSaved();
    const user = userEvent.setup();
    await reachConflict(user);

    await user.click(screen.getByRole("button", { name: "Giữ bản của tôi" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(patchBodies(fetchMock)[1]).toEqual({
      content: { "receiver-name": "Tab B" },
      expectedRevision: 5,
    });
    expect(statusText()).toBe("Đã lưu");
  });

  it("keeps the banner and reports a failed reload", async () => {
    stubStudioFetch({
      get: () => Promise.reject(new TypeError("Failed to fetch")),
      patch: () => jsonResponse(apiError("CONFLICT", { details: { actualRevision: 5 } }), 409),
    });
    const user = userEvent.setup();
    await reachConflict(user);

    await user.click(screen.getByRole("button", { name: "Tải bản mới nhất" }));

    expect(await screen.findByText("Chưa tải được bản mới nhất — thử lại.")).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Tên người nhận" }).value).toBe(
      "Tab B",
    );
  });
});
