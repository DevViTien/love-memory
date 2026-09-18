"use client";

import {
  ApiErrorResponseSchema,
  MediaAssetListResponseSchema,
  MediaAssetResponseSchema,
  MediaUploadGrantResponseSchema,
  type MediaAssetDto,
} from "@love-memory/contracts";
import { Button } from "@love-memory/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { cropImageToAspectRatio } from "./image-crop";

const acceptedTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const maximumBytes = 10 * 1024 * 1024;
const completionAttempts = 3;
const completionRetryDelayMilliseconds = 250;

type UploadItem = MediaAssetDto &
  Readonly<{ fileName: string | undefined; progress: number | undefined }>;

type Props = Readonly<{
  aspectRatio: string;
  fieldId: string;
  giftPublicId: string;
  initialAssetIds: readonly string[];
  label: string;
  maxItems: number;
  minItems: number;
  onChange: (fieldId: string, assetIds: readonly string[]) => void;
}>;

type CropCandidate = Readonly<{ file: File; objectUrl: string }>;

function fileValidationMessage(file: File): string | null {
  if (!acceptedTypes.includes(file.type as (typeof acceptedTypes)[number])) {
    return `${file.name}: chỉ hỗ trợ JPEG, PNG hoặc WebP.`;
  }
  return file.size === 0 || file.size > maximumBytes
    ? `${file.name}: ảnh phải nhỏ hơn 10 MiB.`
    : null;
}

function CropDialog({
  aspectRatio,
  candidate,
  onCancel,
  onConfirm,
}: Readonly<{
  aspectRatio: string;
  candidate: CropCandidate;
  onCancel: () => void;
  onConfirm: (focalX: number, focalY: number) => Promise<void>;
}>) {
  const [focalX, setFocalX] = useState(0.5);
  const [focalY, setFocalY] = useState(0.5);
  const [isCropping, setIsCropping] = useState(false);
  const ratio = aspectRatio.replace(":", " / ");

  return (
    <div
      aria-label="Cắt ảnh theo khung template"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-stone-950/70 p-4"
      role="dialog"
    >
      <div className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl">
        <h2 className="text-xl font-black text-stone-900">Chọn vùng ảnh</h2>
        <p className="mt-1 text-sm text-stone-600">
          Di chuyển tiêu điểm để ảnh vừa khung {aspectRatio} của template.
        </p>
        <div
          className="mt-4 overflow-hidden rounded-2xl bg-stone-100"
          style={{ aspectRatio: ratio }}
        >
          {/* A local object URL never passes through the Next image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="Xem trước vùng ảnh sẽ sử dụng"
            className="h-full w-full object-cover"
            src={candidate.objectUrl}
            style={{ objectPosition: `${focalX * 100}% ${focalY * 100}%` }}
          />
        </div>
        <label className="mt-4 block text-sm font-bold text-stone-700">
          Tiêu điểm ngang
          <input
            className="mt-2 w-full accent-rose-600"
            disabled={isCropping}
            max="1"
            min="0"
            onChange={(event) => setFocalX(Number(event.target.value))}
            step="0.01"
            type="range"
            value={focalX}
          />
        </label>
        <label className="mt-3 block text-sm font-bold text-stone-700">
          Tiêu điểm dọc
          <input
            className="mt-2 w-full accent-rose-600"
            disabled={isCropping}
            max="1"
            min="0"
            onChange={(event) => setFocalY(Number(event.target.value))}
            step="0.01"
            type="range"
            value={focalY}
          />
        </label>
        <div className="mt-5 flex justify-end gap-3">
          <Button disabled={isCropping} onClick={onCancel} variant="outline">
            Bỏ qua ảnh
          </Button>
          <Button
            disabled={isCropping}
            onClick={() => {
              setIsCropping(true);
              void onConfirm(focalX, focalY).finally(() => setIsCropping(false));
            }}
          >
            {isCropping ? "Đang cắt…" : "Dùng vùng ảnh này"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function readApiError(payload: unknown): string {
  const parsed = ApiErrorResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data.error.message : "Yêu cầu media không thành công.";
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function requestUploadCompletion(
  assetId: string,
  giftPublicId: string,
): Promise<MediaAssetDto> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= completionAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch("/api/media/uploads/complete", {
        body: JSON.stringify({ assetId, giftPublicId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Upload completion failed.");
      if (attempt < completionAttempts) {
        await wait(completionRetryDelayMilliseconds * attempt);
        continue;
      }
      throw lastError;
    }

    const payload: unknown = await response.json().catch(() => null);
    const completed = MediaAssetResponseSchema.safeParse(payload);
    if (response.ok && completed.success) return completed.data.data;

    lastError = new Error(readApiError(payload));
    const retryable = response.status === 429 || response.status >= 500 || response.ok;
    if (!retryable || attempt === completionAttempts) throw lastError;
    await wait(completionRetryDelayMilliseconds * attempt);
  }

  throw lastError ?? new Error("Upload completion failed.");
}

function uploadFile(
  url: string,
  file: File,
  headers: Readonly<Record<string, string>>,
  onProgress: (progress: number) => void,
): Readonly<{ abort: () => void; promise: Promise<void> }> {
  const request = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error("Không thể tải ảnh lên kho lưu trữ."));
    });
    request.addEventListener("error", () => reject(new Error("Kết nối tải ảnh bị gián đoạn.")));
    request.addEventListener("abort", () =>
      reject(new DOMException("Upload cancelled", "AbortError")),
    );
    request.send(file);
  });
  return { abort: () => request.abort(), promise };
}

function orderedAssets(
  assets: readonly MediaAssetDto[],
  order: readonly string[],
): MediaAssetDto[] {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...assets].sort(
    (left, right) =>
      (positions.get(left.assetId) ?? Number.MAX_SAFE_INTEGER) -
      (positions.get(right.assetId) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function MediaImageListField({
  aspectRatio,
  fieldId,
  giftPublicId,
  initialAssetIds,
  label,
  maxItems,
  minItems,
  onChange,
}: Props) {
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [cropCandidate, setCropCandidate] = useState<CropCandidate | null>(null);
  const [completingAssetIds, setCompletingAssetIds] = useState<ReadonlySet<string>>(new Set());
  const requests = useRef(new Map<string, () => void>());
  const itemsRef = useRef<readonly UploadItem[]>([]);
  const orderRef = useRef<readonly string[]>(initialAssetIds);
  const cropResolverRef = useRef<((file: File | null) => void) | null>(null);
  const cropObjectUrlRef = useRef<string | null>(null);

  const publishOrder = useCallback(
    (next: readonly UploadItem[]) =>
      onChange(
        fieldId,
        next.map((item) => item.assetId),
      ),
    [fieldId, onChange],
  );

  const commitItems = useCallback(
    (next: readonly UploadItem[], publish = true) => {
      itemsRef.current = next;
      setItems(next);
      if (publish) {
        orderRef.current = next.map((item) => item.assetId);
        publishOrder(next);
      }
    },
    [publishOrder],
  );

  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/media/assets?giftPublicId=${encodeURIComponent(giftPublicId)}`,
      { cache: "no-store" },
    );
    const payload: unknown = await response.json();
    const parsed = MediaAssetListResponseSchema.safeParse(payload);
    if (!response.ok || !parsed.success) throw new Error("Không thể tải trạng thái ảnh.");
    const fieldAssets = orderedAssets(
      parsed.data.data.assets.filter((asset) => asset.fieldId === fieldId),
      orderRef.current,
    );
    const next = fieldAssets.map((asset) => ({
      ...asset,
      fileName: itemsRef.current.find((item) => item.assetId === asset.assetId)?.fileName,
      progress: asset.status === "ready" ? 100 : undefined,
    }));
    const previousOrder = itemsRef.current.map((item) => item.assetId).join(":");
    const nextOrder = next.map((item) => item.assetId).join(":");
    commitItems(next, previousOrder !== nextOrder);
  }, [commitItems, fieldId, giftPublicId]);

  const refreshPending = useCallback(async () => {
    const pending = itemsRef.current.filter(
      (item) => item.status === "uploaded" || item.status === "processing",
    );
    if (pending.length === 0) return;

    const response = await fetch(
      `/api/media/assets?giftPublicId=${encodeURIComponent(giftPublicId)}&includeDownloadUrls=false`,
      { cache: "no-store" },
    );
    const payload: unknown = await response.json();
    const parsed = MediaAssetListResponseSchema.safeParse(payload);
    if (!response.ok || !parsed.success) throw new Error("Unable to refresh media status.");
    const pendingIds = new Set(pending.map((item) => item.assetId));
    const statusUpdates = parsed.data.data.assets.filter((item) => pendingIds.has(item.assetId));
    const updates = await Promise.all(
      statusUpdates.map(async (item) => {
        if (item.status !== "ready") return item;
        const response = await fetch(
          `/api/media/assets/${item.assetId}?giftPublicId=${encodeURIComponent(giftPublicId)}`,
          { cache: "no-store" },
        );
        const payload: unknown = await response.json();
        const parsed = MediaAssetResponseSchema.safeParse(payload);
        if (!response.ok || !parsed.success) throw new Error("Unable to refresh media status.");
        return parsed.data.data;
      }),
    );
    const updatesById = new Map(updates.map((item) => [item.assetId, item]));
    commitItems(
      itemsRef.current.map((item) => {
        const update = updatesById.get(item.assetId);
        return update
          ? {
              ...update,
              fileName: item.fileName,
              progress: update.status === "ready" ? 100 : item.progress,
            }
          : item;
      }),
      false,
    );
  }, [commitItems, giftPublicId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => setMessage("Chưa thể khôi phục danh sách ảnh đã tải."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!items.some((item) => item.status === "uploaded" || item.status === "processing")) return;
    const timer = window.setInterval(() => void refreshPending().catch(() => undefined), 1_500);
    return () => window.clearInterval(timer);
  }, [items, refreshPending]);

  useEffect(() => {
    const activeRequests = requests.current;
    return () => {
      for (const abort of activeRequests.values()) abort();
      activeRequests.clear();
      if (cropObjectUrlRef.current) URL.revokeObjectURL(cropObjectUrlRef.current);
      cropResolverRef.current?.(null);
      cropResolverRef.current = null;
    };
  }, []);

  function requestCrop(file: File): Promise<File | null> {
    return new Promise((resolve) => {
      cropResolverRef.current = resolve;
      const objectUrl = URL.createObjectURL(file);
      cropObjectUrlRef.current = objectUrl;
      setCropCandidate({ file, objectUrl });
    });
  }

  function resolveCrop(file: File | null) {
    if (cropCandidate) URL.revokeObjectURL(cropCandidate.objectUrl);
    cropObjectUrlRef.current = null;
    setCropCandidate(null);
    cropResolverRef.current?.(file);
    cropResolverRef.current = null;
  }

  async function completePendingUpload(item: UploadItem): Promise<void> {
    setCompletingAssetIds((current) => new Set(current).add(item.assetId));
    try {
      const completed = await requestUploadCompletion(item.assetId, giftPublicId);
      commitItems(
        itemsRef.current.map((candidate) =>
          candidate.assetId === item.assetId
            ? { ...completed, fileName: candidate.fileName, progress: 100 }
            : candidate,
        ),
        false,
      );
    } finally {
      setCompletingAssetIds((current) => {
        const next = new Set(current);
        next.delete(item.assetId);
        return next;
      });
    }
  }

  async function startUpload(file: File) {
    const validationMessage = fileValidationMessage(file);
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
    const initResponse = await fetch("/api/media/uploads/init", {
      body: JSON.stringify({
        contentType: file.type,
        fieldId,
        fileName: file.name,
        giftPublicId,
        sizeBytes: file.size,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const initPayload: unknown = await initResponse.json();
    const grant = MediaUploadGrantResponseSchema.safeParse(initPayload);
    if (!initResponse.ok || !grant.success) throw new Error(readApiError(initPayload));

    const pending: UploadItem = {
      assetId: grant.data.data.assetId,
      derivatives: [],
      failureCode: null,
      fieldId,
      fileName: file.name,
      placeholderDataUrl: null,
      progress: 0,
      status: "initiated",
    };
    commitItems([...itemsRef.current, pending]);

    const upload = uploadFile(grant.data.data.url, file, grant.data.data.headers, (progress) =>
      commitItems(
        itemsRef.current.map((item) =>
          item.assetId === pending.assetId ? { ...item, progress } : item,
        ),
        false,
      ),
    );
    requests.current.set(pending.assetId, upload.abort);
    try {
      await upload.promise;
    } finally {
      requests.current.delete(pending.assetId);
    }

    await completePendingUpload(pending);
  }

  async function selectFiles(files: FileList | null) {
    if (!files) return;
    const available = Math.max(0, maxItems - itemsRef.current.length);
    const selected = [...files].slice(0, available);
    if (files.length > available) setMessage(`Template cho phép tối đa ${maxItems} ảnh.`);
    for (const file of selected) {
      try {
        const validationMessage = fileValidationMessage(file);
        if (validationMessage) {
          setMessage(validationMessage);
          continue;
        }
        const cropped = await requestCrop(file);
        if (cropped) await startUpload(cropped);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setMessage(error instanceof Error ? error.message : "Không thể tải ảnh.");
        }
      }
    }
  }

  async function remove(item: UploadItem) {
    requests.current.get(item.assetId)?.();
    const response = await fetch(`/api/media/assets/${item.assetId}`, {
      body: JSON.stringify({ giftPublicId }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
    if (!response.ok) {
      setMessage(readApiError(await response.json().catch(() => null)));
      return;
    }
    commitItems(itemsRef.current.filter((candidate) => candidate.assetId !== item.assetId));
  }

  async function retry(item: UploadItem) {
    const response = await fetch(`/api/media/assets/${item.assetId}/retry`, {
      body: JSON.stringify({ giftPublicId }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!response.ok) setMessage(readApiError(await response.json().catch(() => null)));
    else await refresh();
  }

  async function retryCompletion(item: UploadItem) {
    setMessage(null);
    try {
      await completePendingUpload(item);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to complete the upload.");
    }
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...itemsRef.current];
    [next[index], next[target]] = [next[target]!, next[index]!];
    commitItems(next);
  }

  const blocking = items.some((item) => item.status !== "ready");
  const ratio = aspectRatio.replace(":", " / ");

  return (
    <fieldset className="rounded-2xl border border-rose-200 bg-rose-50/40 p-5">
      <legend className="px-2 font-bold text-stone-800">{label}</legend>
      <p className="text-sm text-stone-600">
        {minItems}–{maxItems} ảnh · JPEG, PNG hoặc WebP · tối đa 10 MiB mỗi ảnh.
      </p>
      <label className="mt-4 inline-flex cursor-pointer rounded-full bg-stone-900 px-4 py-2 text-sm font-bold text-white focus-within:ring-2 focus-within:ring-rose-500">
        Chọn ảnh
        <input
          accept={acceptedTypes.join(",")}
          className="sr-only"
          disabled={cropCandidate !== null || items.length >= maxItems}
          multiple
          onChange={(event) => {
            void selectFiles(event.target.files);
            event.target.value = "";
          }}
          type="file"
        />
      </label>
      <ol className="mt-5 grid gap-4 sm:grid-cols-2">
        {items.map((item, index) => {
          const preview = item.derivatives.at(0)?.url ?? item.placeholderDataUrl;
          return (
            <li className="rounded-2xl border border-rose-100 bg-white p-3" key={item.assetId}>
              <div
                className="overflow-hidden rounded-xl bg-stone-100"
                style={{ aspectRatio: ratio }}
              >
                {preview ? (
                  // Signed private URLs intentionally bypass the public Next image optimizer.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt="Ảnh kỷ niệm đã tải"
                    className="h-full w-full object-cover"
                    src={preview}
                  />
                ) : (
                  <div className="grid h-full place-items-center text-xs font-semibold text-stone-500">
                    {item.progress === undefined ? item.status : `Đang tải ${item.progress}%`}
                  </div>
                )}
              </div>
              <p className="mt-2 truncate text-xs font-semibold text-stone-600">
                {item.fileName ?? item.assetId}
              </p>
              <p className="text-xs text-stone-500">Trạng thái: {item.status}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  size="sm"
                  variant="outline"
                >
                  Trước
                </Button>
                <Button
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                  size="sm"
                  variant="outline"
                >
                  Sau
                </Button>
                {item.status === "failed" && item.failureCode === "PROCESSING_FAILED" ? (
                  <Button onClick={() => void retry(item)} size="sm" variant="outline">
                    Thử lại
                  </Button>
                ) : null}
                {item.status === "initiated" ? (
                  <Button
                    disabled={completingAssetIds.has(item.assetId)}
                    onClick={() => void retryCompletion(item)}
                    size="sm"
                    variant="outline"
                  >
                    {completingAssetIds.has(item.assetId) ? "Đang hoàn tất…" : "Hoàn tất tải lên"}
                  </Button>
                ) : null}
                <Button onClick={() => void remove(item)} size="sm" variant="outline">
                  Xóa
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      {blocking ? (
        <p className="mt-4 text-sm font-semibold text-amber-700" role="status">
          Chưa thể xuất bản: hãy chờ tất cả ảnh xử lý xong hoặc xóa ảnh lỗi.
        </p>
      ) : null}
      {message ? (
        <p className="mt-3 text-sm font-semibold text-rose-700" role="alert">
          {message}
        </p>
      ) : null}
      {cropCandidate ? (
        <CropDialog
          aspectRatio={aspectRatio}
          candidate={cropCandidate}
          onCancel={() => resolveCrop(null)}
          onConfirm={async (focalX, focalY) => {
            try {
              const cropped = await cropImageToAspectRatio(
                cropCandidate.file,
                aspectRatio,
                focalX,
                focalY,
              );
              resolveCrop(cropped);
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "Không thể cắt ảnh đã chọn.");
            }
          }}
        />
      ) : null}
    </fieldset>
  );
}
