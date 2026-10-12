"use client";

import { Button } from "@love-memory/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildQrImage,
  createQrMatrix,
  type QrImage,
  qrFileName,
  QR_STYLE_LABELS,
  QR_STYLES,
  type QrStyle,
  svgDataUrl,
} from "./gift-qr-code";
import { blobToDataUrl, canSaveFiles, qrSvgBlob, renderQrPng, saveBlob } from "./gift-qr-download";

export const GIFT_QR_MESSAGES = {
  intro:
    "Quét mã để mở món quà. In kèm quà tặng, gửi qua tin nhắn hoặc đặt làm hình nền điện thoại.",
  longPress: "Trên điện thoại: nhấn giữ ảnh để lưu vào thư viện ảnh.",
  pngFailed: "Không tạo được ảnh PNG. Hãy thử tải SVG.",
  pngWorking: "Đang tạo PNG…",
  saveUnsupported: "Trình duyệt này không tải được tệp. Hãy nhấn giữ ảnh ở trên để lưu.",
} as const;

type Notice = "pngFailed" | "saveUnsupported";
/**
 * Repeat saves of the same file (style and format) within this time, or during its save, are
 * ignored, so a double click saves once.
 */
export const QR_SAVE_COOLDOWN_MS = 1000;

/**
 * The PNG of one image, shown as the preview so a long press saves it on a phone. The preview is
 * a `data:` URL: some in-app browsers cannot save a `blob:` image.
 */
type PngPreview = Readonly<{ blob: Blob; dataUrl: string; image: QrImage }>;

export function giftQrAlt(style: QrStyle): string {
  return `Mã QR mở món quà, kiểu ${QR_STYLE_LABELS[style]}`;
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

/**
 * `Mã QR` of the published panel (`gift-qr-codes`): the share URL as a QR code in three styles,
 * downloadable as PNG or SVG. It is generated in the browser once the absolute URL is known; the
 * server render shows only the heading and the introduction. The preview is the style's PNG (its
 * SVG until the PNG is ready), because a long press on an image is the one way to save a file in
 * every mobile browser, including in-app browsers that ignore downloads.
 */
export function GiftQrSection({ shareUrl }: Readonly<{ shareUrl: string }>) {
  const [style, setStyle] = useState<QrStyle>("plain");
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pngPreview, setPngPreview] = useState<PngPreview | null>(null);
  const matrix = useMemo(
    () => (isAbsoluteUrl(shareUrl) ? createQrMatrix(shareUrl) : null),
    [shareUrl],
  );
  const image = useMemo(() => (matrix ? buildQrImage(matrix, style) : null), [matrix, style]);
  const preview = image && pngPreview?.image === image ? pngPreview : null;

  const saves = useRef(new Map<string, { busy: boolean; last: number }>());

  useEffect(() => {
    if (!image) return undefined;
    // A late PNG of an earlier style, or after unmount, is dropped.
    let active = true;
    void (async () => {
      const blob = await renderQrPng(image);
      if (!active) return;
      const dataUrl = await blobToDataUrl(blob);
      if (active) setPngPreview({ blob, dataUrl, image });
    })().catch(
      // The preview keeps the SVG; `Tải PNG` reports a failure if it happens again.
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [image]);

  /** Runs one save of `fileName`, unless one is running or ended less than a second ago. */
  async function guarded(fileName: string, run: () => Promise<void> | void) {
    const state = saves.current.get(fileName) ?? { busy: false, last: Number.NEGATIVE_INFINITY };
    saves.current.set(fileName, state);
    if (state.busy || Date.now() - state.last < QR_SAVE_COOLDOWN_MS) return;
    state.busy = true;
    try {
      await run();
    } finally {
      state.busy = false;
      state.last = Date.now();
    }
  }

  function save(blob: Blob, fileName: string) {
    if (!saveBlob(blob, fileName)) setNotice("saveUnsupported");
  }

  async function downloadPng(current: QrImage) {
    setNotice(null);
    if (!canSaveFiles()) {
      setNotice("saveUnsupported");
      return;
    }
    if (preview) {
      save(preview.blob, qrFileName(style, "png"));
      return;
    }
    setWorking(true);
    try {
      save(await renderQrPng(current), qrFileName(style, "png"));
    } catch {
      setNotice("pngFailed");
    } finally {
      setWorking(false);
    }
  }

  function downloadSvg(current: QrImage) {
    setNotice(null);
    save(qrSvgBlob(current), qrFileName(style, "svg"));
  }

  return (
    <section aria-labelledby="published-qr-heading" className="space-y-4">
      <h3 className="text-lg font-black text-stone-900" id="published-qr-heading">
        Mã QR
      </h3>
      <p className="text-sm leading-6 text-stone-700">{GIFT_QR_MESSAGES.intro}</p>
      {image ? (
        <>
          <fieldset>
            <legend className="mb-2 text-sm font-bold text-stone-700">Kiểu mã QR</legend>
            <div className="flex flex-wrap gap-2">
              {QR_STYLES.map((option) => {
                const selected = style === option;
                return (
                  <label
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-rose-500 has-[:focus-visible]:ring-offset-2 ${
                      selected
                        ? "border-2 border-rose-600 bg-rose-50 font-bold text-rose-900"
                        : "border border-stone-300 bg-white font-semibold text-stone-700"
                    }`}
                    key={option}
                  >
                    <input
                      checked={selected}
                      className="sr-only"
                      name="published-qr-style"
                      onChange={() => {
                        setStyle(option);
                        setNotice(null);
                      }}
                      type="radio"
                      value={option}
                    />
                    {selected ? (
                      <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 16 16">
                        <path
                          d="M3 8.5l3 3 7-7"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                        />
                      </svg>
                    ) : null}
                    {QR_STYLE_LABELS[option]}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <figure className="space-y-2">
            <div className="flex justify-center rounded-2xl border border-stone-200 bg-white p-4">
              {/* A generated data: URL; next/image adds nothing here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={giftQrAlt(style)}
                className={style === "wallpaper" ? "h-72 w-auto" : "h-auto w-full max-w-56"}
                height={image.height}
                src={preview?.dataUrl ?? svgDataUrl(image.svg)}
                width={image.width}
              />
            </div>
            <figcaption className="text-sm text-stone-700">{GIFT_QR_MESSAGES.longPress}</figcaption>
          </figure>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={working}
              onClick={() => void guarded(qrFileName(style, "png"), () => downloadPng(image))}
              variant="outline"
            >
              {working ? GIFT_QR_MESSAGES.pngWorking : "Tải PNG"}
            </Button>
            <Button
              onClick={() => void guarded(qrFileName(style, "svg"), () => downloadSvg(image))}
              variant="outline"
            >
              Tải SVG
            </Button>
          </div>
          {notice ? (
            <p className="text-sm font-semibold text-rose-700" role="alert">
              {GIFT_QR_MESSAGES[notice]}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
