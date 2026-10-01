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
      publishStep().getByText("Sau khi xuất bản, bạn không thể chỉnh sửa món quà này."),
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
        "Sau khi xuất bản, bạn chưa thể chỉnh sửa hay thu hồi món quà. Ai có đường dẫn đều mở được món quà.",
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
  });

  it("reloads when the gift was published elsewhere (Gift published in another tab)", async () => {
    stubStudioFetch({
      assets: readyAssets,
      publish: () => jsonResponse(apiError("CONFLICT"), 409),
    });
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
});
