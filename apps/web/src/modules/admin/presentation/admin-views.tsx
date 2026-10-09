import Link from "next/link";

import { type AuditRecord } from "../application/audit";
import { type AdminGiftSummary, type AdminGiftTombstone } from "../application/gift-lookup";

export const ADMIN_LOOKUP_NOT_FOUND = "Không tìm thấy món quà nào.";

const ADMIN_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
});

/** `HH:mm dd/MM/yyyy` in Vietnam time, whatever the server's time zone. */
export function formatAdminTime(date: Date | null): string {
  if (!date) return "—";
  const parts = Object.fromEntries(
    ADMIN_TIME_FORMAT.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts["hour"]}:${parts["minute"]} ${parts["day"]}/${parts["month"]}/${parts["year"]}`;
}

function SummaryRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 border-b border-stone-100 py-2 text-sm">
      <dt className="font-bold text-stone-600">{label}</dt>
      <dd className="font-mono break-all text-stone-900">{value}</dd>
    </div>
  );
}

/** The lookup result: identifiers, state, plan, times, owner and asset counts, nothing else. */
export function AdminGiftSummaryView({ gift }: Readonly<{ gift: AdminGiftSummary }>) {
  const owner =
    gift.owner.kind === "anonymous"
      ? "Bản nháp ẩn danh"
      : `${gift.owner.email ?? "—"} (${gift.owner.id})`;
  const assetCounts = Object.entries(gift.assetCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}: ${count}`)
    .join(", ");

  return (
    <section aria-label="Món quà" className="rounded-2xl border border-stone-200 bg-white p-5">
      <dl>
        <SummaryRow label="Mã nội bộ" value={gift.id} />
        <SummaryRow label="Mã công khai" value={gift.publicId} />
        <SummaryRow label="Trạng thái" value={gift.status} />
        <SummaryRow label="Mẫu quà" value={`${gift.templateId}@${gift.templateVersion}`} />
        <SummaryRow label="Gói" value={gift.planId ?? "—"} />
        <SummaryRow label="Hết hạn" value={formatAdminTime(gift.expiresAt)} />
        <SummaryRow
          label="Phiên bản"
          value={`${gift.revision} (đã đăng: ${gift.publishedRevision ?? "—"})`}
        />
        <SummaryRow label="Tạo lúc" value={formatAdminTime(gift.createdAt)} />
        <SummaryRow label="Cập nhật lúc" value={formatAdminTime(gift.updatedAt)} />
        <SummaryRow label="Đăng lúc" value={formatAdminTime(gift.publishedAt)} />
        <SummaryRow label="Chủ sở hữu" value={owner} />
        <SummaryRow label="Ảnh theo trạng thái" value={assetCounts || "0"} />
      </dl>
      <p className="mt-4 text-sm">
        <Link
          className="font-bold text-rose-700 underline"
          href={{ pathname: "/admin/audit", query: { target: gift.id } }}
        >
          Nhật ký của món quà này
        </Link>
      </p>
    </section>
  );
}

/** A purged gift: `Đã xoá` with its ids and times, nothing else (`admin-access`). */
export function AdminGiftTombstoneView({ tombstone }: Readonly<{ tombstone: AdminGiftTombstone }>) {
  return (
    <section
      aria-label="Món quà đã xoá"
      className="rounded-2xl border border-stone-200 bg-white p-5"
    >
      <p className="mb-3 font-black text-red-700">Đã xoá</p>
      <dl>
        <SummaryRow label="Mã nội bộ" value={tombstone.id} />
        <SummaryRow label="Mã công khai" value={tombstone.publicId} />
        <SummaryRow label="Chủ sở hữu" value={tombstone.ownerId ?? "Bản nháp ẩn danh"} />
        <SummaryRow label="Tạo lúc" value={formatAdminTime(tombstone.createdAt)} />
        <SummaryRow label="Đăng lúc" value={formatAdminTime(tombstone.publishedAt)} />
        <SummaryRow
          label="Yêu cầu xoá lúc"
          value={formatAdminTime(tombstone.deletionRequestedAt)}
        />
        <SummaryRow label="Đã xoá lúc" value={formatAdminTime(tombstone.deletedAt)} />
      </dl>
    </section>
  );
}

function formatMetadata(metadata: AuditRecord["metadata"]): string {
  const entries = Object.entries(metadata);
  return entries.length ? entries.map(([key, value]) => `${key}=${String(value)}`).join(", ") : "—";
}

/** The audit page's list, newest first as given. */
export function AdminAuditTable({ records }: Readonly<{ records: readonly AuditRecord[] }>) {
  if (records.length === 0) {
    return <p className="text-stone-600">Chưa có bản ghi nào.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-stone-600">
          <tr>
            <th className="py-2 pr-4">Thời gian</th>
            <th className="py-2 pr-4">Người thực hiện</th>
            <th className="py-2 pr-4">Hành động</th>
            <th className="py-2 pr-4">Đối tượng</th>
            <th className="py-2">Chi tiết</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {records.map((record) => (
            <tr className="border-t border-stone-100 align-top" key={record.id}>
              <td className="py-2 pr-4 whitespace-nowrap">{formatAdminTime(record.at)}</td>
              <td className="py-2 pr-4 break-all">{`${record.actor.kind}:${record.actor.id}`}</td>
              <td className="py-2 pr-4">{record.action}</td>
              <td className="py-2 pr-4 break-all">
                {record.target ? `${record.target.kind}:${record.target.id}` : "—"}
              </td>
              <td className="py-2 break-all">{formatMetadata(record.metadata)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
