import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildQrImage, createQrMatrix, svgDataUrl } from "./gift-qr-code";
import { GIFT_QR_MESSAGES, GiftQrSection, giftQrAlt, QR_SAVE_COOLDOWN_MS } from "./gift-qr-section";

const download = vi.hoisted(() => ({
  canSaveFiles: vi.fn<() => boolean>(),
  blobToDataUrl: vi.fn<(blob: Blob) => Promise<string>>(),
  qrSvgBlob: vi.fn<(image: { svg: string }) => Blob>(),
  renderQrPng: vi.fn<(image: unknown) => Promise<Blob>>(),
  saveBlob: vi.fn<(blob: Blob, fileName: string) => boolean>(),
}));

vi.mock("./gift-qr-download", () => download);

const shareUrl = "https://lovememory.vn/g/Ab0_-cdefghijklmnopqrs";
const matrix = createQrMatrix(shareUrl);

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

beforeEach(() => {
  download.canSaveFiles.mockReturnValue(true);
  download.qrSvgBlob.mockImplementation((image) => new Blob([image.svg]));
  download.saveBlob.mockReturnValue(true);
  let count = 0;
  download.blobToDataUrl.mockImplementation(() =>
    Promise.resolve(`data:image/png;base64,${(count += 1)}`),
  );
  download.renderQrPng.mockImplementation(() =>
    Promise.resolve(new Blob(["png"], { type: "image/png" })),
  );
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("GiftQrSection", () => {
  it("previews the plain code as SVG, then as its PNG, with the long-press hint", async () => {
    const pending = deferred<Blob>();
    download.renderQrPng.mockReturnValueOnce(pending.promise);
    render(<GiftQrSection shareUrl={shareUrl} />);

    expect(screen.getByRole("heading", { name: "Mã QR" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Cơ bản" })).toHaveProperty("checked", true);
    const preview = screen.getByRole("img", { name: "Mã QR mở món quà, kiểu Cơ bản" });
    expect(preview.getAttribute("src")).toBe(svgDataUrl(buildQrImage(matrix, "plain").svg));
    expect(screen.getByText("Trên điện thoại: nhấn giữ ảnh để lưu vào thư viện ảnh.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tải PNG" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tải SVG" })).toBeTruthy();

    pending.resolve(new Blob(["png"]));
    await waitFor(() => expect(preview.getAttribute("src")).toBe("data:image/png;base64,1"));
    expect(download.renderQrPng).toHaveBeenCalledWith(buildQrImage(matrix, "plain"));
  });

  it("marks the selected style with a check and a strong border, not colour alone", () => {
    render(<GiftQrSection shareUrl={shareUrl} />);

    const selected = screen.getByText("Cơ bản", { selector: "label" });
    const other = screen.getByText("Khung trái tim", { selector: "label" });
    expect(selected.querySelector("svg")).not.toBeNull();
    expect(selected.className).toContain("border-rose-600");
    expect(selected.className).toContain("font-bold");
    expect(other.querySelector("svg")).toBeNull();
  });

  it("switches the style by click and keyboard, with a PNG preview per style", async () => {
    const user = userEvent.setup();
    render(<GiftQrSection shareUrl={shareUrl} />);
    const preview = () => screen.getByRole("img");
    await waitFor(() => expect(preview().getAttribute("src")).toBe("data:image/png;base64,1"));

    await user.click(screen.getByRole("radio", { name: "Khung trái tim" }));
    expect(preview().getAttribute("alt")).toBe(giftQrAlt("heart"));
    await waitFor(() => expect(preview().getAttribute("src")).toBe("data:image/png;base64,2"));

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Hình nền điện thoại" })).toHaveProperty(
      "checked",
      true,
    );
    const wallpaper = screen.getByRole("img", {
      name: "Mã QR mở món quà, kiểu Hình nền điện thoại",
    });
    expect(wallpaper.getAttribute("width")).toBe("1080");
    expect(wallpaper.getAttribute("height")).toBe("2340");
    await waitFor(() => expect(preview().getAttribute("src")).toBe("data:image/png;base64,3"));
  });

  it("ignores the PNG of an earlier style that finishes after a switch", async () => {
    const user = userEvent.setup();
    const plainPng = deferred<Blob>();
    const heartPng = deferred<Blob>();
    download.renderQrPng
      .mockReturnValueOnce(plainPng.promise)
      .mockReturnValueOnce(heartPng.promise);
    render(<GiftQrSection shareUrl={shareUrl} />);
    await user.click(screen.getByRole("radio", { name: "Khung trái tim" }));
    const heartSvg = svgDataUrl(buildQrImage(matrix, "heart").svg);

    plainPng.resolve(new Blob(["plain"]));
    await act(() => plainPng.promise);
    expect(screen.getByRole("img").getAttribute("src")).toBe(heartSvg);
    expect(download.blobToDataUrl).not.toHaveBeenCalled();

    const heart = new Blob(["heart"]);
    heartPng.resolve(heart);
    await waitFor(() =>
      expect(screen.getByRole("img").getAttribute("src")).toBe("data:image/png;base64,1"),
    );
    expect(download.blobToDataUrl).toHaveBeenCalledExactlyOnceWith(heart);
  });

  it("drops a PNG that finishes after unmounting", async () => {
    const pending = deferred<Blob>();
    download.renderQrPng.mockReturnValueOnce(pending.promise);
    const consoleError = vi.spyOn(console, "error");
    const { unmount } = render(<GiftQrSection shareUrl={shareUrl} />);

    unmount();
    pending.resolve(new Blob(["late"]));
    await pending.promise;
    await Promise.resolve();

    expect(download.blobToDataUrl).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("ignores repeat clicks during a save and for a second after it", async () => {
    const user = userEvent.setup();
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const previewPng = deferred<Blob>();
    const downloadPng = deferred<Blob>();
    download.renderQrPng
      .mockReturnValueOnce(previewPng.promise)
      .mockReturnValueOnce(downloadPng.promise);
    render(<GiftQrSection shareUrl={shareUrl} />);
    const svgButton = screen.getByRole("button", { name: "Tải SVG" });

    await user.dblClick(svgButton);
    expect(download.saveBlob).toHaveBeenCalledTimes(1);
    now += QR_SAVE_COOLDOWN_MS - 1;
    await user.click(svgButton);
    expect(download.saveBlob).toHaveBeenCalledTimes(1);
    now += 1;
    await user.click(svgButton);
    expect(download.saveBlob).toHaveBeenCalledTimes(2);

    // A PNG save in progress ignores further clicks, even after the cooldown.
    const pngButton = screen.getByRole("button", { name: "Tải PNG" });
    await user.click(pngButton);
    now += 5 * QR_SAVE_COOLDOWN_MS;
    pngButton.click();
    expect(download.renderQrPng).toHaveBeenCalledTimes(2);
    downloadPng.resolve(new Blob(["png"]));
    expect(await screen.findByRole("button", { name: "Tải PNG" })).toBeTruthy();
    expect(download.saveBlob).toHaveBeenCalledTimes(3);
    await user.click(screen.getByRole("button", { name: "Tải PNG" }));
    expect(download.renderQrPng).toHaveBeenCalledTimes(2);

    // Another style is another file: it saves at once.
    await user.click(screen.getByRole("radio", { name: "Khung trái tim" }));
    await user.click(svgButton);
    expect(download.saveBlob).toHaveBeenCalledTimes(4);
    expect(download.saveBlob).toHaveBeenLastCalledWith(
      expect.any(Blob),
      "qua-tang-qr-trai-tim.svg",
    );
  });

  it("downloads the previewed PNG and the SVG of the selected style", async () => {
    const user = userEvent.setup();
    const heartPng = new Blob(["heart"], { type: "image/png" });
    render(<GiftQrSection shareUrl={shareUrl} />);
    download.renderQrPng.mockResolvedValueOnce(heartPng);
    await user.click(screen.getByRole("radio", { name: "Khung trái tim" }));
    await waitFor(() =>
      expect(screen.getByRole("img").getAttribute("src")).toMatch(/^data:image\/png/),
    );

    await user.click(screen.getByRole("button", { name: "Tải PNG" }));
    expect(download.saveBlob).toHaveBeenLastCalledWith(heartPng, "qua-tang-qr-trai-tim.png");
    // The preview's PNG is reused: one rendering per style.
    expect(download.renderQrPng).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Tải SVG" }));
    const heart = buildQrImage(matrix, "heart");
    expect(download.qrSvgBlob).toHaveBeenCalledWith(heart);
    expect(download.saveBlob).toHaveBeenLastCalledWith(
      expect.any(Blob),
      "qua-tang-qr-trai-tim.svg",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the PNG on demand while the preview is not ready, showing it as busy", async () => {
    const user = userEvent.setup();
    const previewPng = deferred<Blob>();
    const downloadPng = deferred<Blob>();
    download.renderQrPng
      .mockReturnValueOnce(previewPng.promise)
      .mockReturnValueOnce(downloadPng.promise);
    render(<GiftQrSection shareUrl={shareUrl} />);

    await user.click(screen.getByRole("button", { name: "Tải PNG" }));

    expect(screen.getByRole("button", { name: GIFT_QR_MESSAGES.pngWorking })).toHaveProperty(
      "disabled",
      true,
    );
    const png = new Blob(["png"]);
    downloadPng.resolve(png);
    expect(await screen.findByRole("button", { name: "Tải PNG" })).toBeTruthy();
    expect(download.saveBlob).toHaveBeenCalledWith(png, "qua-tang-qr.png");
  });

  it("keeps the SVG preview and offers the SVG when the PNG cannot be made", async () => {
    const user = userEvent.setup();
    download.renderQrPng.mockImplementation(() => Promise.reject(new Error("canvas")));
    render(<GiftQrSection shareUrl={shareUrl} />);

    await user.click(screen.getByRole("button", { name: "Tải PNG" }));

    expect(screen.getByRole("alert").textContent).toBe(GIFT_QR_MESSAGES.pngFailed);
    expect(screen.getByRole("img").getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(download.saveBlob).not.toHaveBeenCalled();
    await user.click(screen.getByRole("radio", { name: "Khung trái tim" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("points to the long press when the browser cannot save files", async () => {
    const user = userEvent.setup();
    download.canSaveFiles.mockReturnValue(false);
    download.saveBlob.mockReturnValue(false);
    render(<GiftQrSection shareUrl={shareUrl} />);

    await user.click(screen.getByRole("button", { name: "Tải PNG" }));
    expect(screen.getByRole("alert").textContent).toBe(GIFT_QR_MESSAGES.saveUnsupported);
    expect(download.saveBlob).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: "Khung trái tim" }));
    await user.click(screen.getByRole("button", { name: "Tải SVG" }));
    expect(screen.getByRole("alert").textContent).toBe(GIFT_QR_MESSAGES.saveUnsupported);
  });

  it("waits for the absolute URL before drawing a code", () => {
    const html = renderToString(<GiftQrSection shareUrl="/g/Ab0_-cdefghijklmnopqrs" />);

    expect(html).toContain("Mã QR");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Tải PNG");
  });
});
