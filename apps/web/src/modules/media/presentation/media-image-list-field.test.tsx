import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MediaImageListField } from "./media-image-list-field";

const cropMocks = vi.hoisted(() => ({ cropImageToAspectRatio: vi.fn() }));

vi.mock("./image-crop", () => ({ cropImageToAspectRatio: cropMocks.cropImageToAspectRatio }));

const assetId = "550e8400-e29b-41d4-a716-446655440000";

class UploadRequest extends EventTarget {
  static instances: UploadRequest[] = [];
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
