import { type TemplateVersionState } from "../application/template-version-controls";
import { TemplateVersionActions } from "./template-version-actions";

export type AdminTemplateVersionRow = TemplateVersionState & Readonly<{ hasArtifact: boolean }>;

const STATUS_LABELS: Readonly<Record<TemplateVersionState["status"], string>> = {
  draft: "Bản nháp (draft)",
  published: "Đang phát hành (published)",
  retired: "Đã ngừng (retired)",
};

/** `/admin/templates` (`template-version-controls` "Admin template page"). */
export function AdminTemplateVersionsTable({
  versions,
}: Readonly<{ versions: readonly AdminTemplateVersionRow[] }>) {
  if (versions.length === 0) {
    return <p className="text-stone-600">Chưa có phiên bản mẫu nào.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-stone-600">
          <tr>
            <th className="py-2 pr-4">Phiên bản</th>
            <th className="py-2 pr-4">Trạng thái</th>
            <th className="py-2 pr-4">Hiệu ứng</th>
            <th className="py-2">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((row) => (
            <tr
              className="border-t border-stone-100 align-top"
              key={`${row.templateId}@${row.version}`}
            >
              <td className="py-3 pr-4">
                <p className="font-mono font-bold text-stone-900">{`${row.templateId}@${row.version}`}</p>
                {row.current ? (
                  <p className="text-xs font-semibold text-emerald-700">Phiên bản hiện tại</p>
                ) : null}
              </td>
              <td className="py-3 pr-4">{STATUS_LABELS[row.status]}</td>
              <td className="py-3 pr-4">
                {row.killed ? (
                  <p className="font-bold text-red-700">
                    Đã tắt <span className="font-mono">({row.killReason ?? "other"})</span>
                  </p>
                ) : row.hasArtifact ? (
                  "Có"
                ) : (
                  "Chưa có"
                )}
              </td>
              <td className="py-3">
                <TemplateVersionActions
                  killed={row.killed}
                  status={row.status}
                  templateId={row.templateId}
                  version={row.version}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
