import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MediaImageListField } from "./media-image-list-field";

const cropMocks = vi.hoisted(() => ({ cropImageToAspectRatio: vi.fn() }));

vi.mock("./image-crop", () => ({ cropImageToAspectRatio: cropMocks.cropImageToAspectRatio }));

const assetId = "550e8400-e29b-41d4-a716-446655440000";

class UploadRequest extends EventTarget {
  static instances: UploadRequest[] = [];
  /** Replaces the default successful transfer for one test. */
  static onSend: ((request: UploadRequest) => void) | null = null;
  readonly abort = vi.fn(() => this.dispatchEvent(new Event("abort")));
  readonly upload = new EventTarget();
  status = 200;

  constructor() {
    super();
    UploadRequest.instances.push(this);
  }

  open() {}
  setRequestHeader() {}

  send() {
    if (UploadRequest.onSend) {
      UploadRequest.onSend(this);
      return;
    }
    queueMicrotask(() => {
      this.upload.dispatchEvent(
        new ProgressEvent("progress", { lengthComputable: true, loaded: 1, total: 2 }),
      );
      queueMicrotask(() => this.dispatchEvent(new Event("load")));
    });
  }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("MediaImageListField", () => {
  beforeEach(() => {
    UploadRequest.instances = [];
    UploadRequest.onSend = null;
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:crop-preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    cropMocks.cropImageToAspectRatio.mockImplementation((file: File) => Promise.resolve(file));
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("/api/media/assets?")) {
          return Promise.resolve(jsonResponse({ data: { assets: [] } }));
        }
        if (url === "/api/media/uploads/init") {
          return Promise.resolve(
            jsonResponse(
              {
                data: {
                  assetId,
                  expiresAt: "2026-09-17T00:10:00.000Z",
                  headers: { "content-type": "image/jpeg" },
                  method: "PUT",
                  url: "https://blob.example/upload",
                },
              },
              201,
            ),
          );
        }
        if (url === "/api/media/uploads/complete") {
          return Promise.resolve(
            jsonResponse(
              {
                data: {
                  assetId,
                  derivatives: [],
                  failureCode: null,
                  fieldId: "photos",
                  placeholderDataUrl: null,
                  status: "ready",
                },
              },
              202,
            ),
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the active XHR alive across progress renders and completes the upload", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MediaImageListField
        aspectRatio="4:3"
        fieldId="photos"
        giftPublicId="abcdefghijklmnop"
        initialAssetIds={[]}
        label="Ảnh kỷ niệm"
        maxItems={3}
        minItems={1}
        onChange={onChange}
      />,
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("assets?"), expect.anything()),
    );

    const file = new File([Uint8Array.from([1, 2, 3])], "memory.jpg", {
      type: "image/jpeg",
    });
    fireEvent.change(screen.getByLabelText("Chọn ảnh"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Dùng vùng ảnh này" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/media/uploads/complete",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(UploadRequest.instances).toHaveLength(1);
    expect(UploadRequest.instances[0]?.abort).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("photos", [assetId]);
  });

  it("shows the image count, how many are missing, and the Studio picker id", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          data: {
            assets: [
              {
                assetId,
                derivatives: [],
                failureCode: null,
                fieldId: "photos",
                placeholderDataUrl: null,
                status: "ready",
              },
            ],
          },
        }),
      ),
    );
    render(
      <MediaImageListField
        aspectRatio="4:5"
        errorMessageId="studio-field-photos-error"
        fieldId="photos"
        giftPublicId="abcdefghijklmnop"
        initialAssetIds={[assetId]}
        inputId="studio-field-photos"
        label="Kỷ niệm"
        maxItems={8}
        minItems={3}
        onChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("1/8 ảnh")).toBeTruthy();
    expect(screen.getByText("Cần thêm 2 ảnh")).toBeTruthy();
    const picker = screen.getByLabelText<HTMLInputElement>("Chọn ảnh");
    expect(picker.id).toBe("studio-field-photos");
    expect(picker.getAttribute("aria-invalid")).toBe("true");
    expect(picker.getAttribute("aria-describedby")).toBe("studio-field-photos-error");
  });

  it("reports an empty order when none of the saved assets exists any more", async () => {
    const onChange = vi.fn();
    render(
      <MediaImageListField
        aspectRatio="4:3"
        fieldId="photos"
        giftPublicId="abcdefghijklmnop"
        initialAssetIds={[assetId]}
        label="Ảnh kỷ niệm"
        maxItems={3}
        minItems={1}
        onChange={onChange}
      />,
    );

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("photos", []));
  });

  it("ignores a second selection until the current one has finished", async () => {
    const user = userEvent.setup();
    render(
      <MediaImageListField
        aspectRatio="4:3"
        fieldId="photos"
        giftPublicId="abcdefghijklmnop"
        initialAssetIds={[]}
        label="Ảnh kỷ niệm"
        maxItems={3}
        minItems={1}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("assets?"), expect.anything()),
    );
    const picker = screen.getByLabelText<HTMLInputElement>("Chọn ảnh");
    const first = new File([Uint8Array.from([1])], "first.jpg", { type: "image/jpeg" });
    const second = new File([Uint8Array.from([2])], "second.jpg", { type: "image/jpeg" });

    fireEvent.change(picker, { target: { files: [first] } });
    fireEvent.change(picker, { target: { files: [second] } });

    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
    expect(picker.disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Dùng vùng ảnh này" }));
    await waitFor(() => expect(picker.disabled).toBe(false));
    expect(UploadRequest.instances).toHaveLength(1);
  });

  it("lets a restored initiated asset retry the idempotent completion request", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("/api/media/assets?")) {
        return Promise.resolve(
          jsonResponse({
            data: {
              assets: [
                {
                  assetId,
                  derivatives: [],
                  failureCode: null,
                  fieldId: "photos",
                  placeholderDataUrl: null,
                  status: "initiated",
                },
              ],
            },
          }),
        );
      }
      if (url === "/api/media/uploads/complete") {
        return Promise.resolve(
          jsonResponse(
            {
              data: {
                assetId,
                derivatives: [],
                failureCode: null,
                fieldId: "photos",
                placeholderDataUrl: null,
                status: "ready",
              },
            },
            202,
          ),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MediaImageListField
        aspectRatio="4:3"
        fieldId="photos"
        giftPublicId="abcdefghijklmnop"
        initialAssetIds={[assetId]}
        label="Ảnh kỷ niệm"
        maxItems={3}
        minItems={1}
        onChange={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Hoàn tất tải lên" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/media/uploads/complete",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Hoàn tất tải lên" })).toBeNull(),
    );
  });
});

describe("MediaImageListField captions", () => {
  const firstId = "550e8400-e29b-41d4-a716-446655440001";
  const secondId = "550e8400-e29b-41d4-a716-446655440002";
  const unsavedId = "550e8400-e29b-41d4-a716-446655440003";

  function readyAsset(id: string) {
    return {
      assetId: id,
      derivatives: [],
      failureCode: null,
      fieldId: "memories",
      placeholderDataUrl: null,
      status: "ready",
    };
  }

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("/api/media/assets?")) {
          return Promise.resolve(
            jsonResponse({
              data: {
                assets: [readyAsset(firstId), readyAsset(secondId), readyAsset(unsavedId)],
              },
            }),
          );
        }
        if (url.startsWith("/api/media/assets/") && init?.method === "DELETE") {
          return Promise.resolve(jsonResponse({ data: { deleted: true } }));
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderField(onChange = vi.fn()) {
    render(
      <MediaImageListField
        aspectRatio="4:5"
        captionMaxLength={140}
        fieldId="memories"
        giftPublicId="abcdefghijklmnop"
        initialAssetIds={[firstId, secondId]}
        initialCaptions={{ [firstId]: "Biển Nha Trang" }}
        label="Kỷ niệm"
        maxItems={8}
        minItems={3}
        onChange={onChange}
      />,
    );
    return onChange;
  }

  it("restores saved captions and leaves recovered unsaved images without one", async () => {
    const onChange = renderField();

    expect((await screen.findByLabelText<HTMLInputElement>("Chú thích ảnh 1")).value).toBe(
      "Biển Nha Trang",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Chú thích ảnh 2").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Chú thích ảnh 3").value).toBe("");
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith("memories", [
        { assetId: firstId, caption: "Biển Nha Trang" },
        { assetId: secondId },
        { assetId: unsavedId },
      ]),
    );
  });

  it("keeps a caption with its image when the image is reordered", async () => {
    const user = userEvent.setup();
    const onChange = renderField();
    await screen.findByLabelText("Chú thích ảnh 1");

    await user.click(screen.getAllByRole("button", { name: "Sau" })[0]!);

    expect(onChange).toHaveBeenLastCalledWith("memories", [
      { assetId: secondId },
      { assetId: firstId, caption: "Biển Nha Trang" },
      { assetId: unsavedId },
    ]);
    expect(screen.getByLabelText<HTMLInputElement>("Chú thích ảnh 2").value).toBe("Biển Nha Trang");
  });

  it("omits a caption that is blank after trimming", async () => {
    const user = userEvent.setup();
    const onChange = renderField();

    await user.type(await screen.findByLabelText("Chú thích ảnh 2"), "   ");

    expect(onChange).toHaveBeenLastCalledWith("memories", [
      { assetId: firstId, caption: "Biển Nha Trang" },
      { assetId: secondId },
      { assetId: unsavedId },
    ]);
  });

  it("discards a caption together with its deleted image", async () => {
    const user = userEvent.setup();
    const onChange = renderField();
    await screen.findByLabelText("Chú thích ảnh 1");

    await user.click(screen.getAllByRole("button", { name: "Xóa" })[0]!);

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith("memories", [
        { assetId: secondId },
        { assetId: unsavedId },
      ]),
    );
    expect(screen.getByLabelText<HTMLInputElement>("Chú thích ảnh 1").value).toBe("");
  });

  it("stops at the caption limit and shows the remaining count", async () => {
    renderField();
    const input = await screen.findByLabelText<HTMLInputElement>("Chú thích ảnh 2");

    fireEvent.change(input, { target: { value: "x".repeat(150) } });

    expect(input.value).toHaveLength(140);
    expect(screen.getByText("Còn 0 ký tự")).toBeTruthy();
  });
});

describe("MediaImageListField failures and labels", () => {
  const giftPublicId = "abcdefghijklmnop";
  type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

  function grant() {
    return jsonResponse(
      {
        data: {
          assetId,
          expiresAt: "2026-09-17T00:10:00.000Z",
          headers: { "content-type": "image/jpeg" },
          method: "PUT",
          url: "https://blob.example/upload",
        },
      },
      201,
    );
  }

  function asset(status: string, overrides: Record<string, unknown> = {}) {
    return {
      assetId,
      derivatives: [],
      failureCode: null,
      fieldId: "photos",
      placeholderDataUrl: null,
      status,
      ...overrides,
    };
  }

  function stubFetch(handler: Handler, assets: readonly unknown[] = []) {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const handled = handler(url, init);
      if (handled) return Promise.resolve(handled);
      if (url.startsWith("/api/media/assets?")) {
        return Promise.resolve(jsonResponse({ data: { assets } }));
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function renderField(props: Partial<Parameters<typeof MediaImageListField>[0]> = {}) {
    const onChange = vi.fn();
    const view = render(
      <MediaImageListField
        aspectRatio="4:3"
        fieldId="photos"
        giftPublicId={giftPublicId}
        initialAssetIds={[]}
        label="Ảnh kỷ niệm"
        maxItems={3}
        minItems={1}
        onChange={onChange}
        {...props}
      />,
    );
    return { ...view, onChange };
  }

  async function pickAndConfirm(user: ReturnType<typeof userEvent.setup>) {
    const file = new File([Uint8Array.from([1, 2, 3])], "memory.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Chọn ảnh"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Dùng vùng ảnh này" }));
  }

  beforeEach(() => {
    UploadRequest.instances = [];
    UploadRequest.onSend = null;
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:crop-preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    cropMocks.cropImageToAspectRatio.mockImplementation((file: File) => Promise.resolve(file));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows Vietnamese status labels and a position instead of raw values (Labels instead of raw values)", async () => {
    stubFetch(() => undefined, [asset("processing")]);
    renderField({ initialAssetIds: [assetId] });

    expect(await screen.findByText("Ảnh 1")).toBeTruthy();
    expect(screen.getAllByText("Đang xử lý").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain(assetId);
    expect(document.body.textContent).not.toContain("processing");
    expect(screen.getByText("1–3 ảnh · JPEG, PNG hoặc WebP · tối đa 10 MB mỗi ảnh.")).toBeTruthy();
  });

  it("deletes the asset of an interrupted transfer and asks to pick it again (Transfer interrupted)", async () => {
    const deletes: string[] = [];
    stubFetch((url, init) => {
      if (url === "/api/media/uploads/init") return grant();
      if (url === `/api/media/assets/${assetId}` && init?.method === "DELETE") {
        deletes.push(url);
        return jsonResponse({ data: { deleted: true } });
      }
      return undefined;
    });
    UploadRequest.onSend = (request) => {
      queueMicrotask(() => request.dispatchEvent(new Event("error")));
    };
    const user = userEvent.setup();
    const { onChange } = renderField();
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    await pickAndConfirm(user);

    expect(
      await screen.findByText("Kết nối tải ảnh bị gián đoạn. Hãy chọn lại ảnh này."),
    ).toBeTruthy();
    expect(deletes).toEqual([`/api/media/assets/${assetId}`]);
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("photos", []));
    expect(screen.queryByRole("button", { name: "Hoàn tất tải lên" })).toBeNull();
  });

  it("aborts a transfer without progress for 30 seconds (Transfer stalls)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch((url, init) => {
      if (url === "/api/media/uploads/init") return grant();
      if (init?.method === "DELETE") return jsonResponse({ data: { deleted: true } });
      return undefined;
    });
    UploadRequest.onSend = () => {
      // Never reports progress or completion.
    };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderField();
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    await pickAndConfirm(user);
    await waitFor(() => expect(UploadRequest.instances).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(UploadRequest.instances[0]?.abort).toHaveBeenCalledOnce();
    expect(
      await screen.findByText("Kết nối tải ảnh bị gián đoạn. Hãy chọn lại ảnh này."),
    ).toBeTruthy();
  });

  it("starts no upload when it is unmounted while the grant is requested (Field unmounted during an upload)", async () => {
    let answerGrant: (response: Response) => void = () => undefined;
    const fetchMock = stubFetch((url) =>
      url === "/api/media/uploads/init"
        ? new Promise<Response>((resolve) => (answerGrant = resolve))
        : undefined,
    );
    const user = userEvent.setup();
    const { onChange, unmount } = renderField();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await pickAndConfirm(user);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/media/uploads/init", expect.anything()),
    );
    onChange.mockClear();

    unmount();
    answerGrant(grant());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(UploadRequest.instances).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the item and explains a delete without a connection (Delete without a connection)", async () => {
    stubFetch(
      (url, init) => {
        if (init?.method === "DELETE") throw new TypeError("Failed to fetch");
        return undefined;
      },
      [asset("ready")],
    );
    const user = userEvent.setup();
    renderField({ initialAssetIds: [assetId] });

    await user.click(await screen.findByRole("button", { name: "Xóa" }));

    expect(await screen.findByText("Chưa xóa được ảnh — thử lại.")).toBeTruthy();
    expect(screen.getByText("1/3 ảnh")).toBeTruthy();
  });

  it("keeps the item and shows the API message when a delete is refused (Delete refused)", async () => {
    stubFetch(
      (_url, init) =>
        init?.method === "DELETE"
          ? jsonResponse(
              { error: { code: "CONFLICT", message: "Ảnh đang được dùng.", requestId: "r-1" } },
              409,
            )
          : undefined,
      [asset("ready")],
    );
    const user = userEvent.setup();
    renderField({ initialAssetIds: [assetId] });

    await user.click(await screen.findByRole("button", { name: "Xóa" }));

    expect(await screen.findByText("Ảnh đang được dùng.")).toBeTruthy();
    expect(screen.getByText("1/3 ảnh")).toBeTruthy();
  });

  it("explains a processing retry that fails at the network level", async () => {
    stubFetch(
      (url) => {
        if (url.endsWith("/retry")) throw new TypeError("Failed to fetch");
        return undefined;
      },
      [asset("failed", { failureCode: "PROCESSING_FAILED" })],
    );
    const user = userEvent.setup();
    renderField({ initialAssetIds: [assetId] });

    await user.click(await screen.findByRole("button", { name: "Thử lại" }));

    expect(await screen.findByText("Chưa thử xử lý lại được ảnh — thử lại.")).toBeTruthy();
  });

  it("offers only delete for a terminal failure (Terminal failure has no retry)", async () => {
    stubFetch(() => undefined, [asset("failed", { failureCode: "DECODE_FAILED" })]);
    renderField({ initialAssetIds: [assetId] });

    expect(await screen.findByRole("button", { name: "Xóa" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
    expect(screen.getAllByText("Lỗi xử lý").length).toBeGreaterThan(0);
  });

  it("disables the picker and every item action while read-only", async () => {
    stubFetch(() => undefined, [asset("ready")]);
    renderField({ disabled: true, initialAssetIds: [assetId] });

    await screen.findByText("1/3 ảnh");
    expect(screen.getByLabelText<HTMLInputElement>("Chọn ảnh").disabled).toBe(true);
    for (const name of ["Trước", "Sau", "Xóa"]) {
      expect(screen.getByRole<HTMLButtonElement>("button", { name }).disabled).toBe(true);
    }
  });

  it("explains a skipped file and a selection above the limit (Unsupported file skipped)", async () => {
    stubFetch(() => undefined);
    renderField({ maxItems: 1 });
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    const gif = new File([Uint8Array.from([1])], "anim.gif", { type: "image/gif" });
    const jpeg = new File([Uint8Array.from([1])], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Chọn ảnh"), { target: { files: [gif, jpeg] } });

    expect(await screen.findByText("anim.gif: chỉ hỗ trợ JPEG, PNG hoặc WebP.")).toBeTruthy();
  });
});
