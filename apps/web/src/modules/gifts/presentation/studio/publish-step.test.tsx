import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as PublishActionModule from "./publish-action";
import { routerRefresh } from "./test/next-navigation";
import { apiError, assetIds, jsonResponse } from "./test/fixtures";
import {
  analyticsEventNames,
  editorElement,
  readyAsset,
  renderEditor,
  type RenderEditorOptions,
  setStudioUrl,
  stubStudioFetch,
  studioAnalytics,
  urlOf,
} from "./test/render-editor";

const publishMocks = vi.hoisted(() => ({ reload: vi.fn() }));

vi.mock("next/navigation", () => import("./test/next-navigation"));
vi.mock("./publish-action", async (importOriginal) => ({
  ...(await importOriginal<typeof PublishActionModule>()),
  reloadStudioPage: publishMocks.reload,
}));

const publicId = "q1w2e3r4t5y6u7i8";
const shareId = "Ab0_-cdefghijklmnopqrs";
const completeContent = {
  "final-letter": "Anh nhớ em.",
  memories: assetIds.map((assetId) => ({ assetId })),
  "opening-message": "Mở hộp nhé",
  "receiver-name": "Linh",
};
const readyAssets = assetIds.map((assetId) => readyAsset(assetId));

function published(revision: number) {
  return jsonResponse(
    {
      data: {
        publication: {
          publicId,
          publishedAt: "2026-10-01T08:00:00.000Z",
          revision,
          shareId,
          sharePath: `/g/${shareId}`,
          status: "published",
        },
      },
    },
    201,
  );
}

function publishPosts(fetchMock: ReturnType<typeof stubStudioFetch>) {
  return fetchMock.mock.calls.filter(
    ([input, init]) => urlOf(input).endsWith("/publish") && init?.method === "POST",
  );
}

function publishStep() {
  return within(screen.getByRole("region", { name: "Xuất bản" }));
}

function publishButton() {
  return publishStep().getByRole<HTMLButtonElement>("button", { name: /^Xuất bản$/ });
}

function confirmButton() {
  return publishStep().getByRole<HTMLButtonElement>("button", {
    name: /Xác nhận xuất bản|Đang xuất bản…/,
  });
}

/** `Xuất bản`, then `Xác nhận xuất bản` in the confirmation. */
async function publishNow(user: UserEvent) {
  await user.click(publishButton());
  await user.click(confirmButton());
}

const owner: RenderEditorOptions = {
  content: completeContent,
  ownerKind: "user",
  publishEnabled: true,
  signedIn: true,
};

async function openReadyPublishStep(options: RenderEditorOptions = owner) {
  setStudioUrl("?step=publish");
  const view = renderEditor(options);
  await screen.findAllByText("3/8 ảnh");
  return view;
}

beforeEach(() => {
  publishMocks.reload.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Xuất bản step: availability", () => {
  it("asks a visitor to sign in for an anonymous draft (Anonymous draft must be claimed)", async () => {
    const fetchMock = stubStudioFetch({ assets: readyAssets, publish: () => published(0) });
    const user = userEvent.setup();
    await openReadyPublishStep({ content: completeContent });

    expect(publishButton().disabled).toBe(true);
    expect(publishStep().getByText("Đăng nhập và lưu quà vào tài khoản để xuất bản.")).toBeTruthy();
    const link = publishStep().getByRole("link", { name: "Đăng nhập để xuất bản" });
    expect(link.getAttribute("href")).toBe(`/auth/sign-in?next=%2Fstudio%2F${publicId}`);

    await user.click(publishButton());
    expect(publishPosts(fetchMock)).toHaveLength(0);
  });

  it("offers the claim to a signed-in creator, then enables publishing (Signed in with an unclaimed draft)", async () => {
    stubStudioFetch({ assets: readyAssets });
    const view = await openReadyPublishStep({
      content: completeContent,
      publishEnabled: true,
      signedIn: true,
    });

    expect(publishStep().getByRole("button", { name: "Lưu bản nháp vào tài khoản" })).toBeTruthy();
    expect(publishButton().disabled).toBe(true);

    // A successful claim refreshes the page, which passes the claimed owner kind.
    view.rerender(editorElement(owner));

    expect(publishButton().disabled).toBe(false);
    expect(publishStep().queryByRole("button", { name: "Lưu bản nháp vào tài khoản" })).toBeNull();
    expect(
      publishStep().getByText(
        "Sau khi xuất bản, bạn vẫn có thể chỉnh sửa và cập nhật món quà tại cùng đường dẫn.",
      ),
    ).toBeTruthy();
  });

  it("explains that publishing is not enabled (Publishing not enabled)", async () => {
    stubStudioFetch({ assets: readyAssets });
    await openReadyPublishStep({ ...owner, publishEnabled: false });

    expect(publishButton().disabled).toBe(true);
    expect(publishStep().getByText("Xuất bản chưa được mở cho tài khoản này.")).toBeTruthy();
  });

  it("blocks publishing while a step is missing (Incomplete steps block publishing)", () => {
    stubStudioFetch();
    setStudioUrl("?step=publish");
    renderEditor({ ...owner, content: { "receiver-name": "Linh" } });

    expect(publishButton().disabled).toBe(true);
    expect(publishStep().getByText("Hoàn thiện các bước còn thiếu để xuất bản.")).toBeTruthy();
  });
});

describe("Xuất bản step: confirmation", () => {
  it("asks for confirmation before any request (Publish asks for confirmation)", async () => {
    const fetchMock = stubStudioFetch({ assets: readyAssets, publish: () => published(0) });
    const user = userEvent.setup();
    await openReadyPublishStep();

    await user.click(publishButton());

    const heading = publishStep().getByRole("heading", { name: "Xuất bản món quà này?" });
    expect(document.activeElement).toBe(heading);
    expect(
      publishStep().getByText(
        "Ai có đường dẫn đều mở được món quà. Bạn có thể chỉnh sửa và cập nhật sau, nhưng chưa thể thu hồi đường dẫn.",
      ),
    ).toBeTruthy();
    expect(publishPosts(fetchMock)).toHaveLength(0);
  });

  it("closes without publishing (Confirmation cancelled)", async () => {
    const fetchMock = stubStudioFetch({ assets: readyAssets, publish: () => published(0) });
    const user = userEvent.setup();
    await openReadyPublishStep();

    await user.click(publishButton());
    await user.click(publishStep().getByRole("button", { name: "Quay lại chỉnh sửa" }));

    expect(publishStep().queryByRole("heading", { name: "Xuất bản món quà này?" })).toBeNull();
    expect(publishButton().disabled).toBe(false);
    expect(publishPosts(fetchMock)).toHaveLength(0);
  });

  it("explains a template version without an artifact before any work (Template version without an artifact)", async () => {
    stubStudioFetch({ assets: readyAssets });
    await openReadyPublishStep({ ...owner, publishable: false });

    expect(publishButton().disabled).toBe(true);
    expect(
      publishStep().getByText("Phiên bản mẫu của món quà này không hỗ trợ xuất bản."),
    ).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain(
      "Phiên bản mẫu của bản nháp này chưa hỗ trợ xuất bản.",
    );
  });

  it("shows no template-version notice for a publishable version (Draft on a publishable version)", async () => {
    stubStudioFetch({ assets: readyAssets });
    await openReadyPublishStep();

    expect(screen.queryByRole("note")).toBeNull();
  });

  it("makes the fields editable again after a failed publish (Publish fails and editing resumes)", async () => {
    stubStudioFetch({
      assets: readyAssets,
      publish: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const user = userEvent.setup();
    await openReadyPublishStep();

    await publishNow(user);

    expect(await publishStep().findByText("Chưa xuất bản được — thử lại.")).toBeTruthy();
    const letter = screen.getByRole<HTMLTextAreaElement>("textbox", {
      hidden: true,
      name: "Lá thư",
    });
    expect(letter.disabled).toBe(false);
    expect(letter.value).toBe("Anh nhớ em.");
  });
});

describe("Xuất bản step: publishing", () => {
  it("saves a pending change, publishes that revision and shows the panel (Publish after a pending change)", async () => {
    const fetchMock = stubStudioFetch({
      assets: readyAssets,
      publish: (init) => {
        const body = JSON.parse(init.body as string) as { expectedRevision: number };
        return published(body.expectedRevision);
      },
    });
    const user = userEvent.setup();
    setStudioUrl("?step=recipient");
    renderEditor(owner);
    await screen.findAllByText("3/8 ảnh");

    const refreshesBefore = routerRefresh.calls;
    await user.type(screen.getByRole("textbox", { name: "Tên người nhận" }), "!");
    await user.click(screen.getByRole("button", { name: /^7\. Xuất bản/ }));
    await publishNow(user);

    expect(await screen.findByRole("heading", { name: "Đã xuất bản" })).toBeTruthy();
    // The page is refreshed, so the server renders the published gift without the draft aside.
    expect(routerRefresh.calls).toBe(refreshesBefore + 1);
    const order = fetchMock.mock.calls
      .filter(([input]) => urlOf(input).startsWith("/api/gifts/"))
      .map(([input, init]) => `${init?.method} ${urlOf(input)}`);
    expect(order).toEqual([`PATCH /api/gifts/${publicId}`, `POST /api/gifts/${publicId}/publish`]);
    const [, init] = publishPosts(fetchMock)[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({ expectedRevision: 1 });
    expect(new Headers(init?.headers).get("Idempotency-Key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(screen.queryByRole("textbox", { name: "Tên người nhận" })).toBeNull();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Đường dẫn món quà" }).value).toBe(
      `${window.location.origin}/g/${shareId}`,
    );
  });

  it("lists rejected fields with Sửa links and inline errors (Publish rejected content)", async () => {
    stubStudioFetch({
      assets: readyAssets,
      publish: () =>
        jsonResponse(
          apiError("VALIDATION_ERROR", {
            fieldErrors: { "memories.2": "This image is not ready." },
          }),
          400,
        ),
    });
    const user = userEvent.setup();
    await openReadyPublishStep();

    await publishNow(user);

    expect(
      await publishStep().findByText("Chưa xuất bản được: một số nội dung chưa sẵn sàng."),
    ).toBeTruthy();
    const item = publishStep().getByRole("listitem");
    expect(item.firstElementChild?.textContent).toBe("Kỷ niệm");
    const fix = within(item).getByRole("link", { name: "Sửa" });
    expect(fix.getAttribute("href")).toBe(`/studio/${publicId}?field=memories`);

    await user.click(fix);
    expect(window.location.search).toBe("?step=memories");
    const memories = within(screen.getByRole("region", { name: "Kỷ niệm" }));
    expect(
      memories.getAllByText("Nội dung này chưa hợp lệ, hãy kiểm tra lại.").length,
    ).toBeGreaterThan(0);
  });

  it("keeps the key for a retry after a network error (Publish request fails)", async () => {
    let attempt = 0;
    const fetchMock = stubStudioFetch({
      assets: readyAssets,
      publish: () => {
        attempt += 1;
        if (attempt === 1) throw new TypeError("Failed to fetch");
        return published(0);
      },
    });
    const user = userEvent.setup();
    await openReadyPublishStep();

    await publishNow(user);
    expect(await publishStep().findByText("Chưa xuất bản được — thử lại.")).toBeTruthy();
    await publishNow(user);

    expect(await screen.findByRole("heading", { name: "Đã xuất bản" })).toBeTruthy();
    const keys = publishPosts(fetchMock).map(([, init]) =>
      new Headers(init?.headers).get("Idempotency-Key"),
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("sends one request for a double click (Double click on publish)", async () => {
    let respond: (response: Response) => void = () => undefined;
    const fetchMock = stubStudioFetch({
      assets: readyAssets,
      publish: () => new Promise<Response>((resolve) => (respond = resolve)),
    });
    const user = userEvent.setup();
    await openReadyPublishStep();

    await user.click(publishButton());
    await user.dblClick(confirmButton());

    await waitFor(() => expect(publishPosts(fetchMock)).toHaveLength(1));
    expect(
      publishStep().getByRole<HTMLButtonElement>("button", { name: "Đang xuất bản…" }).disabled,
    ).toBe(true);
    // The editor is frozen while the request runs (Typing while publishing).
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Lá thư", hidden: true }).disabled,
    ).toBe(true);
    respond(published(0));
    expect(await screen.findByRole("heading", { name: "Đã xuất bản" })).toBeTruthy();
    expect(publishPosts(fetchMock)).toHaveLength(1);
    // The editor stays and is editable again: the owner keeps editing the working copy.
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Lá thư", hidden: true }).disabled,
    ).toBe(false);
  });

  it.each([
    ["without details", () => jsonResponse(apiError("CONFLICT"), 409)],
    [
      "with NO_UNPUBLISHED_CHANGES",
      () =>
        jsonResponse(apiError("CONFLICT", { details: { reason: "NO_UNPUBLISHED_CHANGES" } }), 409),
    ],
  ])("reloads for a 409 %s (Gift published in another tab)", async (_name, publish) => {
    stubStudioFetch({ assets: readyAssets, publish });
    const user = userEvent.setup();
    await openReadyPublishStep();

    await publishNow(user);

    await waitFor(() => expect(publishMocks.reload).toHaveBeenCalledOnce());
  });

  it("stays without reloading for a version that cannot be published (Template version cannot be published)", async () => {
    stubStudioFetch({
      assets: readyAssets,
      publish: () =>
        jsonResponse(
          apiError("CONFLICT", { details: { reason: "TEMPLATE_VERSION_NOT_EDITABLE" } }),
          409,
        ),
    });
    const user = userEvent.setup();
    await openReadyPublishStep();

    await publishNow(user);

    expect(
      await publishStep().findByText("Phiên bản mẫu của món quà này không hỗ trợ xuất bản."),
    ).toBeTruthy();
    expect(publishMocks.reload).not.toHaveBeenCalled();
    expect(publishButton().disabled).toBe(false);
  });

  it.each([
    [
      "401",
      () => jsonResponse(apiError("UNAUTHORIZED"), 401),
      "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để xuất bản.",
    ],
    [
      "403",
      () => jsonResponse(apiError("FORBIDDEN"), 403),
      "Xuất bản chưa được mở cho tài khoản này.",
    ],
    [
      "429",
      () => jsonResponse(apiError("RATE_LIMITED", { details: { retryAfterSeconds: 120 } }), 429),
      "Bạn thử xuất bản quá nhiều lần. Hãy thử lại sau 120 giây.",
    ],
    [
      "an unpublishable version",
      () =>
        jsonResponse(
          apiError("CONFLICT", { details: { reason: "TEMPLATE_VERSION_UNPUBLISHABLE" } }),
          409,
        ),
      "Phiên bản mẫu của món quà này không hỗ trợ xuất bản.",
    ],
    [
      "an unsupported access policy",
      () =>
        jsonResponse(
          apiError("CONFLICT", { details: { reason: "ACCESS_POLICY_UNSUPPORTED" } }),
          409,
        ),
      "Chế độ truy cập của món quà này chưa hỗ trợ xuất bản.",
    ],
  ])("explains %s", async (_name, publish, message) => {
    stubStudioFetch({ assets: readyAssets, publish });
    const user = userEvent.setup();
    await openReadyPublishStep();

    await publishNow(user);

    expect(await publishStep().findByText(message)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Đã xuất bản" })).toBeNull();
  });

  it("offers sign-in again after a 401", async () => {
    stubStudioFetch({
      assets: readyAssets,
      publish: () => jsonResponse(apiError("UNAUTHORIZED"), 401),
    });
    const user = userEvent.setup();
    await openReadyPublishStep();

    await publishNow(user);

    const link = await publishStep().findByRole("link", { name: "Đăng nhập lại" });
    expect(link.getAttribute("href")).toBe(`/auth/sign-in?next=%2Fstudio%2F${publicId}`);
  });

  it("shows the conflict banner for a stale revision", async () => {
    stubStudioFetch({
      assets: readyAssets,
      publish: () =>
        jsonResponse(
          apiError("CONFLICT", { details: { actualRevision: 5, expectedRevision: 0 } }),
          409,
        ),
    });
    const user = userEvent.setup();
    await openReadyPublishStep();

    await publishNow(user);

    expect((await screen.findByRole("button", { name: "Tải bản mới nhất" })).textContent).toBe(
      "Tải bản mới nhất",
    );
  });

  it("shows the non-editable alert for a 404", async () => {
    stubStudioFetch({
      assets: readyAssets,
      publish: () => jsonResponse(apiError("NOT_FOUND"), 404),
    });
    const user = userEvent.setup();
    await openReadyPublishStep();

    await publishNow(user);

    expect(
      await screen.findByText("Bản nháp này không còn chỉnh sửa được. Hãy tải lại trang."),
    ).toBeTruthy();
    // Read-only from then on (Draft no longer editable).
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { hidden: true, name: "Lá thư" }).disabled,
    ).toBe(true);
  });
});

describe("Cập nhật món quà step: a published gift", () => {
  const publication = {
    publishedAt: "2026-10-01T08:00:00.000Z",
    revision: 0,
    shareId,
    sharePath: `/g/${shareId}`,
  };
  const publishedOwner: RenderEditorOptions = { ...owner, publication };

  function updateButton() {
    return publishStep().getByRole<HTMLButtonElement>("button", { name: "Cập nhật món quà" });
  }

  function confirmUpdateButton() {
    return publishStep().getByRole<HTMLButtonElement>("button", {
      name: /Xác nhận cập nhật|Đang cập nhật…/,
    });
  }

  async function editLetter(user: UserEvent) {
    await user.click(screen.getByRole("button", { name: /^4\. Lá thư/ }));
    await user.type(screen.getByRole("textbox", { name: "Lá thư" }), " Thật nhiều.");
    await user.click(screen.getByRole("button", { name: /^7\. Xuất bản/ }));
  }

  it("shows the panel above the editor and nothing to update (Nothing to update)", async () => {
    stubStudioFetch({ assets: readyAssets, publication });
    await openReadyPublishStep(publishedOwner);

    expect(screen.getByRole("heading", { name: "Đã xuất bản" })).toBeTruthy();
    expect(screen.getByText("Người nhận đang xem bản mới nhất.")).toBeTruthy();
    expect(updateButton().disabled).toBe(true);
    expect(
      publishStep().getByText(
        "Người nhận đang xem bản mới nhất. Hãy chỉnh sửa trước khi cập nhật.",
      ),
    ).toBeTruthy();
  });

  it("saves, updates that revision and shows the latest status (Owner updates a published gift)", async () => {
    const fetchMock = stubStudioFetch({
      assets: readyAssets,
      publication,
      publish: (init) => {
        const body = JSON.parse(init.body as string) as { expectedRevision: number };
        return published(body.expectedRevision);
      },
    });
    const user = userEvent.setup();
    setStudioUrl("?step=publish");
    renderEditor(publishedOwner);
    await screen.findAllByText("3/8 ảnh");

    await editLetter(user);
    expect(updateButton().disabled).toBe(false);
    expect(
      publishStep().getByText("Người nhận sẽ thấy nội dung mới tại đường dẫn hiện tại."),
    ).toBeTruthy();
    await user.click(updateButton());
    expect(publishStep().getByRole("heading", { name: "Cập nhật món quà đã gửi?" })).toBeTruthy();
    await user.click(confirmUpdateButton());

    expect(await publishStep().findByText("Đã cập nhật món quà.")).toBeTruthy();
    expect(screen.getByText("Người nhận đang xem bản mới nhất.")).toBeTruthy();
    const [, init] = publishPosts(fetchMock)[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({ expectedRevision: 1 });
    expect(updateButton().disabled).toBe(true);
  });

  it("shows unpublished changes in the panel after a save (Unpublished changes shown after a save)", async () => {
    stubStudioFetch({ assets: readyAssets, publication });
    const user = userEvent.setup();
    setStudioUrl("?step=letter");
    renderEditor(publishedOwner);
    await screen.findAllByText("3/8 ảnh");

    await user.type(screen.getByRole("textbox", { name: "Lá thư" }), "!");
    await user.click(screen.getByRole("button", { name: "Lưu ngay" }));

    expect(
      await screen.findByText(
        "Có thay đổi chưa cập nhật. Người nhận vẫn đang xem bản đã gửi trước đó.",
      ),
    ).toBeTruthy();
  });

  it("keeps the key for a retry and says the update failed (Update request fails)", async () => {
    let attempt = 0;
    const fetchMock = stubStudioFetch({
      assets: readyAssets,
      publication,
      publish: () => {
        attempt += 1;
        if (attempt === 1) throw new TypeError("Failed to fetch");
        return published(1);
      },
    });
    const user = userEvent.setup();
    setStudioUrl("?step=publish");
    renderEditor(publishedOwner);
    await screen.findAllByText("3/8 ảnh");

    await editLetter(user);
    await user.click(updateButton());
    await user.click(confirmUpdateButton());
    expect(await publishStep().findByText("Chưa cập nhật được — thử lại.")).toBeTruthy();
    await user.click(updateButton());
    await user.click(confirmUpdateButton());

    expect(await publishStep().findByText("Đã cập nhật món quà.")).toBeTruthy();
    const keys = publishPosts(fetchMock).map(([, init]) =>
      new Headers(init?.headers).get("Idempotency-Key"),
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("uses a new key for the update after a first publish (New key after a success)", async () => {
    const fetchMock = stubStudioFetch({
      assets: readyAssets,
      publish: (init) => {
        const body = JSON.parse(init.body as string) as { expectedRevision: number };
        return published(body.expectedRevision);
      },
    });
    const user = userEvent.setup();
    await openReadyPublishStep();

    await publishNow(user);
    expect(await screen.findByRole("heading", { name: "Đã xuất bản" })).toBeTruthy();
    await editLetter(user);
    await user.click(updateButton());
    await user.click(confirmUpdateButton());
    expect(await publishStep().findByText("Đã cập nhật món quà.")).toBeTruthy();

    const keys = publishPosts(fetchMock).map(([, init]) =>
      new Headers(init?.headers).get("Idempotency-Key"),
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("sends no analytics event while a published gift is edited and updated (Editing a published gift)", async () => {
    window.sessionStorage.clear();
    const fetchMock = stubStudioFetch({
      assets: readyAssets,
      publication,
      publish: () => published(1),
    });
    const user = userEvent.setup();
    setStudioUrl("?step=publish");
    renderEditor({ ...publishedOwner, analytics: studioAnalytics });
    await screen.findAllByText("3/8 ảnh");

    await editLetter(user);
    await user.click(updateButton());
    await user.click(confirmUpdateButton());
    expect(await publishStep().findByText("Đã cập nhật món quà.")).toBeTruthy();

    expect(analyticsEventNames(fetchMock)).toEqual([]);
  });
});

describe("Xuất bản step: funnel analytics", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("sends no publish_clicked for a click on the disabled action (Disabled publish action)", async () => {
    const fetchMock = stubStudioFetch({ assets: readyAssets, publish: () => published(0) });
    const user = userEvent.setup();
    await openReadyPublishStep({ analytics: studioAnalytics, content: completeContent });

    expect(publishButton().disabled).toBe(true);
    await user.click(publishButton());

    expect(analyticsEventNames(fetchMock)).not.toContain("publish_clicked");
    expect(publishPosts(fetchMock)).toHaveLength(0);
  });

  it("sends one publish_clicked for a double click on the enabled action, before the request", async () => {
    let respond: (response: Response) => void = () => undefined;
    const fetchMock = stubStudioFetch({
      assets: readyAssets,
      publish: () => new Promise<Response>((resolve) => (respond = resolve)),
    });
    const user = userEvent.setup();
    await openReadyPublishStep({ ...owner, analytics: studioAnalytics });

    await user.dblClick(publishButton());
    expect(analyticsEventNames(fetchMock).filter((name) => name === "publish_clicked")).toEqual([
      "publish_clicked",
    ]);
    await user.click(confirmButton());
    await waitFor(() => expect(publishPosts(fetchMock)).toHaveLength(1));
    respond(published(0));
    expect(await screen.findByRole("heading", { name: "Đã xuất bản" })).toBeTruthy();

    expect(analyticsEventNames(fetchMock).filter((name) => name === "publish_clicked")).toEqual([
      "publish_clicked",
    ]);
  });

  it("sends nothing after the first publish in the same page", async () => {
    const fetchMock = stubStudioFetch({
      assets: readyAssets,
      publish: (init) => {
        const body = JSON.parse(init.body as string) as { expectedRevision: number };
        return published(body.expectedRevision);
      },
    });
    const user = userEvent.setup();
    await openReadyPublishStep({ ...owner, analytics: studioAnalytics });

    await publishNow(user);
    expect(await screen.findByRole("heading", { name: "Đã xuất bản" })).toBeTruthy();
    const before = analyticsEventNames(fetchMock).length;
    await user.click(screen.getByRole("button", { name: /^4\. Lá thư/ }));
    await user.type(screen.getByRole("textbox", { name: "Lá thư" }), "!");
    await user.click(screen.getByRole("button", { name: "Lưu ngay" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").length,
      ).toBeGreaterThan(0),
    );

    expect(analyticsEventNames(fetchMock)).toHaveLength(before);
  });
});
