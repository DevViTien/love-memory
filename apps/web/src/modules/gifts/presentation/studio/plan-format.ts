import { type PlanOfferDto } from "@love-memory/contracts";

/** `Miễn phí` for a free plan, otherwise the amount with `.` thousands separators and `đ`. */
export function formatPlanPrice(priceVnd: number): string {
  return priceVnd === 0 ? "Miễn phí" : `${new Intl.NumberFormat("vi-VN").format(priceVnd)}đ`;
}

export function formatPhotoLimit(maxPhotos: number | null): string {
  return maxPhotos === null ? "Tất cả ảnh mẫu quà cho phép" : `Tối đa ${maxPhotos} ảnh`;
}

export function formatWatermark(watermark: boolean): string {
  return watermark
    ? "Có dòng chữ “Tạo bằng LoveMemory”"
    : "Không có dòng chữ “Tạo bằng LoveMemory”";
}

export function formatRetention(retentionDays: number): string {
  return retentionDays === 365
    ? "Người nhận mở được trong 1 năm"
    : `Người nhận mở được trong ${retentionDays} ngày`;
}

const EXPIRY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
});

/** `HH:mm dd/MM/yyyy` in Vietnam time, whatever the browser's locale and time zone. */
export function formatExpiry(iso: string): string {
  const parts = Object.fromEntries(
    EXPIRY_FORMAT.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${parts["hour"]}:${parts["minute"]} ${parts["day"]}/${parts["month"]}/${parts["year"]}`;
}

/** The plan's name from the server-rendered offers; the id only if the page sent none. */
export function planName(offers: readonly PlanOfferDto[], planId: string): string {
  return offers.find((offer) => offer.planId === planId)?.name ?? planId;
}
