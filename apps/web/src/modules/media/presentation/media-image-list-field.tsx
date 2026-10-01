"use client";

import {
  ApiErrorResponseSchema,
  MediaAssetListResponseSchema,
  MediaAssetResponseSchema,
  MediaUploadGrantResponseSchema,
  type MediaAssetDto,
} from "@love-memory/contracts";
import { type CaptionedImageItem } from "@love-memory/template-sdk";
import { Button } from "@love-memory/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { fetchWithTimeout } from "@/http/fetch-with-timeout";

import { cropImageToAspectRatio } from "./image-crop";

const acceptedTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const maximumBytes = 10 * 1024 * 1024;
const completionAttempts = 3;
const completionRetryDelayMilliseconds = 250;
/** A grant or completion request that has not answered after 15 s is aborted. */
export const MEDIA_REQUEST_TIMEOUT_MILLISECONDS = 15_000;
/** A transfer that reports no progress for 30 s is aborted as interrupted. */
export const UPLOAD_STALL_TIMEOUT_MILLISECONDS = 30_000;
export const INTERRUPTED_UPLOAD_MESSAGE = "Kết nối tải ảnh bị gián đoạn. Hãy chọn lại ảnh này.";
const DELETE_FAILED_MESSAGE = "Chưa xóa được ảnh — thử lại.";
const RETRY_FAILED_MESSAGE = "Chưa thử xử lý lại được ảnh — thử lại.";

/** Vietnamese labels of the asset statuses; raw status values are never shown. */
const STATUS_LABELS: Readonly<Record<MediaAssetDto["status"], string>> = {
  deleted: "Đã xóa",
  deleting: "Đang xóa",
  failed: "Lỗi xử lý",
  initiated: "Đang tải lên",
  processing: "Đang xử lý",
  ready: "Sẵn sàng",
  uploaded: "Đang xử lý",
};

export function mediaStatusLabel(status: MediaAssetDto["status"]): string {
  return STATUS_LABELS[status];
}

function isPending(item: Pick<MediaAssetDto, "status">): boolean {
  return item.status === "uploaded" || item.status === "processing";
}

type UploadItem = MediaAssetDto &
  Readonly<{ fileName: string | undefined; progress: number | undefined }>;

export type ImageFieldValue = readonly string[] | readonly CaptionedImageItem[];

type Props = Readonly<{
  aspectRatio: string;
  /** Enables one caption per image; the field then reports `{ assetId, caption? }` items. */
  captionMaxLength?: number | undefined;
  /** Read-only: the picker, captions and every item action are disabled (Studio publishing). */
  disabled?: boolean | undefined;
  fieldId: string;
  giftPublicId: string;
  initialAssetIds: readonly string[];
  initialCaptions?: Readonly<Record<string, string>>;
  /** Id of the file picker, so Studio deep links and `Sửa` links can focus it. */
  inputId?: string | undefined;
  /** Id of an error message outside the field; marks the picker invalid and describes it. */
  errorMessageId?: string | undefined;
  label: string;
  maxItems: number;
  minItems: number;
  onChange: (fieldId: string, value: ImageFieldValue) => void;
}>;

type CropCandidate = Readonly<{ file: File; objectUrl: string }>;

function fileValidationMessage(file: File): string | null {
  if (!acceptedTypes.includes(file.type as (typeof acceptedTypes)[number])) {
    return `${file.name}: chỉ hỗ trợ JPEG, PNG hoặc WebP.`;
  }
  return file.size === 0 || file.size > maximumBytes
    ? `${file.name}: ảnh phải nhỏ hơn 10 MB.`
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
  // Portrait frames (e.g. 4:5) would push the actions below a short laptop viewport, so the preview
  // is at most half the viewport tall and the dialog itself scrolls as a last resort.
  const previewWidth = `min(100%, calc(50dvh * ${ratio}))`;

  return (
    <div
      aria-label="Cắt ảnh theo khung mẫu quà"
      aria-modal="true"
      className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/70 p-4"
      role="dialog"
    >
      <div className="mx-auto my-auto flex min-h-full w-full max-w-lg items-center">
        <div className="w-full rounded-3xl bg-white p-5 shadow-2xl">
          <h2 className="text-xl font-black text-stone-900">Chọn vùng ảnh</h2>
          <p className="mt-1 text-sm text-stone-600">
            Di chuyển tiêu điểm để ảnh vừa khung {aspectRatio} của mẫu quà.
          </p>
          <div
            className="mx-auto mt-4 overflow-hidden rounded-2xl bg-stone-100"
            style={{ aspectRatio: ratio, width: previewWidth }}
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
          <div className="mt-5 flex flex-wrap justify-end gap-3">
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
      // A completion that never answers counts as a network failure and is retried.
      response = await fetchWithTimeout(
        fetch,
        "/api/media/uploads/complete",
        {
          body: JSON.stringify({ assetId, giftPublicId }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
        MEDIA_REQUEST_TIMEOUT_MILLISECONDS,
      );
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
  let stalled = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  // Restarted on every progress event: a slow but moving upload never stalls.
  const watchStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      request.abort();
    }, UPLOAD_STALL_TIMEOUT_MILLISECONDS);
  };
  const promise = new Promise<void>((resolve, reject) => {
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.addEventListener("progress", (event) => {
      watchStall();
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new UploadInterruptedError());
    });
    request.addEventListener("error", () => reject(new UploadInterruptedError()));
    request.addEventListener("abort", () =>
      // A stall is an interruption; any other abort is a cancellation by the creator or unmount.
      reject(
        stalled ? new UploadInterruptedError() : new DOMException("Upload cancelled", "AbortError"),
      ),
    );
    watchStall();
    request.send(file);
  }).finally(() => clearTimeout(stallTimer));
  return { abort: () => request.abort(), promise };
}

/** The transfer failed, was refused by the storage, or stalled: the asset never got its bytes. */
class UploadInterruptedError extends Error {
  constructor() {
    super(INTERRUPTED_UPLOAD_MESSAGE);
    this.name = "UploadInterruptedError";
  }
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
  captionMaxLength,
  disabled = false,
  fieldId,
  giftPublicId,
  initialAssetIds,
  initialCaptions,
  inputId,
  errorMessageId,
  label,
  maxItems,
  minItems,
  onChange,
}: Props) {
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [cropCandidate, setCropCandidate] = useState<CropCandidate | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [completingAssetIds, setCompletingAssetIds] = useState<ReadonlySet<string>>(new Set());
  const [captions, setCaptions] = useState<Readonly<Record<string, string>>>(
    () => initialCaptions ?? {},
  );
  const captionsRef = useRef<Readonly<Record<string, string>>>(captions);
  const requests = useRef(new Map<string, () => void>());
  const itemsRef = useRef<readonly UploadItem[]>([]);
  const orderRef = useRef<readonly string[]>(initialAssetIds);
  const cropResolverRef = useRef<((file: File | null) => void) | null>(null);
  const cropObjectUrlRef = useRef<string | null>(null);
  const selectingRef = useRef(false);
  const legendRef = useRef<HTMLLegendElement>(null);
  const pickerFocusedRef = useRef(false);
  /** `false` after unmount: no request starts and nothing is reported to the editor any more. */
  const aliveRef = useRef(true);
  const refreshingRef = useRef(false);

  const publishOrder = useCallback(
    (next: readonly UploadItem[]) => {
      // An unmounted field (for example after `Tải bản mới nhất` re-seeded it) must never
      // overwrite newer content with its stale order.
      if (!aliveRef.current) return;
      onChange(
        fieldId,
        captionMaxLength === undefined
          ? next.map((item) => item.assetId)
          : next.map(({ assetId }) => {
              const caption = captionsRef.current[assetId]?.trim();
              return caption ? { assetId, caption } : { assetId };
            }),
      );
    },
    [captionMaxLength, fieldId, onChange],
  );

  const commitItems = useCallback(
    (next: readonly UploadItem[], publish = true) => {
      if (!aliveRef.current) return;
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
    // Compare with the saved order, not the in-memory list (empty on mount), so a field whose saved
    // assets are all gone reports an empty order and the draft becomes savable again.
    const previousOrder = orderRef.current.join(":");
    const nextOrder = next.map((item) => item.assetId).join(":");
    commitItems(next, previousOrder !== nextOrder);
  }, [commitItems, fieldId, giftPublicId]);

  const refreshPendingItems = useCallback(
    async (pending: readonly UploadItem[]) => {
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
    },
    [commitItems, giftPublicId],
  );

  const refreshPending = useCallback(async () => {
    const pending = itemsRef.current.filter(isPending);
    // Single flight: an older answer must not flip `ready` back to `processing`.
    if (pending.length === 0 || refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      await refreshPendingItems(pending);
    } finally {
      refreshingRef.current = false;
    }
  }, [refreshPendingItems]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => {
        if (aliveRef.current) setMessage("Chưa thể khôi phục danh sách ảnh đã tải.");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Keyed on whether anything is pending, so upload progress does not restart the interval.
  const hasPending = items.some(isPending);
  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => void refreshPending().catch(() => undefined), 1_500);
    return () => window.clearInterval(timer);
  }, [hasPending, refreshPending]);

  useEffect(() => {
    aliveRef.current = true;
    const activeRequests = requests.current;
    return () => {
      aliveRef.current = false;
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
      if (cropObjectUrlRef.current) URL.revokeObjectURL(cropObjectUrlRef.current);
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
    let initResponse: Response;
    try {
      initResponse = await fetchWithTimeout(
        fetch,
        "/api/media/uploads/init",
        {
          body: JSON.stringify({
            contentType: file.type,
            fieldId,
            fileName: file.name,
            giftPublicId,
            sizeBytes: file.size,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
        MEDIA_REQUEST_TIMEOUT_MILLISECONDS,
      );
    } catch {
      throw new Error("Chưa xin được quyền tải ảnh lên — thử lại.");
    }
    const initPayload: unknown = await initResponse.json().catch(() => null);
    const grant = MediaUploadGrantResponseSchema.safeParse(initPayload);
    if (!initResponse.ok || !grant.success) throw new Error(readApiError(initPayload));
    // Unmounted while the grant was requested: no upload starts for it.
    if (!aliveRef.current) return;

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
    } catch (error) {
      if (error instanceof UploadInterruptedError) await discardInterruptedUpload(pending.assetId);
      throw error;
    } finally {
      requests.current.delete(pending.assetId);
    }
    if (!aliveRef.current) return;

    await completePendingUpload(pending);
  }

  /**
   * An interrupted transfer stored nothing, so completing it can never succeed: delete the asset
   * and drop its item, and the creator picks the image again. When the delete fails too, the item
   * stays with its delete action.
   */
  async function discardInterruptedUpload(assetId: string): Promise<void> {
    if (!aliveRef.current) return;
    try {
      const response = await fetchWithTimeout(
        fetch,
        `/api/media/assets/${assetId}`,
        {
          body: JSON.stringify({ giftPublicId }),
          headers: { "Content-Type": "application/json" },
          method: "DELETE",
        },
        MEDIA_REQUEST_TIMEOUT_MILLISECONDS,
      );
      if (!response.ok) return;
    } catch {
      return;
    }
    commitItems(itemsRef.current.filter((candidate) => candidate.assetId !== assetId));
  }

  async function selectFiles(files: FileList | null) {
    // One select-crop-upload loop at a time: a second loop would overwrite the crop resolver and
    // compute capacity independently of the first.
    if (!files || selectingRef.current) return;
    selectingRef.current = true;
    setIsSelecting(true);
    try {
      await processSelection([...files]);
    } finally {
      selectingRef.current = false;
      setIsSelecting(false);
    }
  }

  async function processSelection(files: readonly File[]) {
    const available = Math.max(0, maxItems - itemsRef.current.length);
    const selected = files.slice(0, available);
    if (files.length > available) setMessage(`Mẫu quà cho phép tối đa ${maxItems} ảnh.`);
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
        if (aliveRef.current && !(error instanceof DOMException && error.name === "AbortError")) {
          setMessage(error instanceof Error ? error.message : "Không thể tải ảnh.");
        }
      }
    }
  }

  async function remove(item: UploadItem) {
    requests.current.get(item.assetId)?.();
    let response: Response;
    try {
      response = await fetchWithTimeout(
        fetch,
        `/api/media/assets/${item.assetId}`,
        {
          body: JSON.stringify({ giftPublicId }),
          headers: { "Content-Type": "application/json" },
          method: "DELETE",
        },
        MEDIA_REQUEST_TIMEOUT_MILLISECONDS,
      );
    } catch {
      if (aliveRef.current) setMessage(DELETE_FAILED_MESSAGE);
      return;
    }
    if (!aliveRef.current) return;
    if (!response.ok) {
      setMessage(readApiError(await response.json().catch(() => null)));
      return;
    }
    const { [item.assetId]: _discarded, ...remainingCaptions } = captionsRef.current;
    captionsRef.current = remainingCaptions;
    setCaptions(remainingCaptions);
    commitItems(itemsRef.current.filter((candidate) => candidate.assetId !== item.assetId));
  }

  function updateCaption(assetId: string, text: string) {
    const next = { ...captionsRef.current, [assetId]: text.slice(0, captionMaxLength) };
    captionsRef.current = next;
    setCaptions(next);
    publishOrder(itemsRef.current);
  }

  async function retry(item: UploadItem) {
    try {
      const response = await fetchWithTimeout(
        fetch,
        `/api/media/assets/${item.assetId}/retry`,
        {
          body: JSON.stringify({ giftPublicId }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
        MEDIA_REQUEST_TIMEOUT_MILLISECONDS,
      );
      if (!aliveRef.current) return;
      if (!response.ok) setMessage(readApiError(await response.json().catch(() => null)));
      else await refresh();
    } catch {
      if (aliveRef.current) setMessage(RETRY_FAILED_MESSAGE);
    }
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
  const pickerDisabled =
    disabled || isSelecting || cropCandidate !== null || items.length >= maxItems;

  // A disabled picker cannot hold focus. When it is disabled while focused (for example a
  // `?field=` deep link focused it before the saved images loaded to `maxItems`), focus moves to
  // the field's legend instead of being lost.
  useLayoutEffect(() => {
    if (!pickerDisabled || !pickerFocusedRef.current) return;
    pickerFocusedRef.current = false;
    legendRef.current?.focus({ preventScroll: true });
  }, [pickerDisabled]);

  return (
    <fieldset className="rounded-2xl border border-rose-200 bg-rose-50/40 p-5">
      <legend
        className="px-2 font-bold text-stone-800 focus:outline-none"
        ref={legendRef}
        tabIndex={-1}
      >
        {label}
      </legend>
      <p className="text-sm text-stone-600">
        {minItems}–{maxItems} ảnh · JPEG, PNG hoặc WebP · tối đa 10 MB mỗi ảnh.
      </p>
      <p className="mt-1 text-sm font-semibold text-stone-700">
        <span>
          {items.length}/{maxItems} ảnh
        </span>
        {items.length < minItems ? (
          <span className="ml-2 text-amber-700">Cần thêm {minItems - items.length} ảnh</span>
        ) : null}
      </p>
      <label className="mt-4 inline-flex cursor-pointer rounded-full bg-stone-900 px-4 py-2 text-sm font-bold text-white focus-within:ring-2 focus-within:ring-rose-500">
        Chọn ảnh
        <input
          accept={acceptedTypes.join(",")}
          aria-describedby={errorMessageId}
          aria-invalid={errorMessageId === undefined ? undefined : true}
          className="sr-only"
          disabled={pickerDisabled}
          multiple
          onBlur={(event) => {
            // A blur caused by disabling the picker keeps the flag, so the legend takes focus.
            if (!event.currentTarget.disabled) pickerFocusedRef.current = false;
          }}
          onChange={(event) => {
            void selectFiles(event.target.files);
            event.target.value = "";
          }}
          onFocus={() => {
            pickerFocusedRef.current = true;
          }}
          id={inputId}
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
                    {item.progress === undefined
                      ? mediaStatusLabel(item.status)
                      : `Đang tải ${item.progress}%`}
                  </div>
                )}
              </div>
              <p className="mt-2 truncate text-xs font-semibold text-stone-600">
                {item.fileName ?? `Ảnh ${index + 1}`}
              </p>
              {item.status === "ready" ? null : (
                <p className="text-xs text-stone-500">{mediaStatusLabel(item.status)}</p>
              )}
              {captionMaxLength === undefined ? null : (
                <div className="mt-3">
                  <label className="block text-xs font-semibold text-stone-700">
                    Chú thích ảnh {index + 1}
                    <input
                      aria-describedby={`${fieldId}-${item.assetId}-caption-count`}
                      className="mt-1 h-10 w-full rounded-xl border border-rose-200 bg-white px-3 text-sm font-normal"
                      disabled={disabled}
                      maxLength={captionMaxLength}
                      onChange={(event) => updateCaption(item.assetId, event.target.value)}
                      value={captions[item.assetId] ?? ""}
                    />
                  </label>
                  <p
                    className="mt-1 text-xs text-stone-500"
                    id={`${fieldId}-${item.assetId}-caption-count`}
                  >
                    Còn {captionMaxLength - (captions[item.assetId] ?? "").length} ký tự
                  </p>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                  size="sm"
                  variant="outline"
                >
                  Trước
                </Button>
                <Button
                  disabled={disabled || index === items.length - 1}
                  onClick={() => move(index, 1)}
                  size="sm"
                  variant="outline"
                >
                  Sau
                </Button>
                {item.status === "failed" && item.failureCode === "PROCESSING_FAILED" ? (
                  <Button
                    disabled={disabled}
                    onClick={() => void retry(item)}
                    size="sm"
                    variant="outline"
                  >
                    Thử lại
                  </Button>
                ) : null}
                {item.status === "initiated" ? (
                  <Button
                    disabled={disabled || completingAssetIds.has(item.assetId)}
                    onClick={() => void retryCompletion(item)}
                    size="sm"
                    variant="outline"
                  >
                    {completingAssetIds.has(item.assetId) ? "Đang hoàn tất…" : "Hoàn tất tải lên"}
                  </Button>
                ) : null}
                <Button
                  disabled={disabled}
                  onClick={() => void remove(item)}
                  size="sm"
                  variant="outline"
                >
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
