import { type Route } from "next";
import Link from "next/link";

import { type PreviewIssueItem } from "./preview-issues";

type Props = Readonly<{
  canEdit: boolean;
  items: readonly PreviewIssueItem[];
  templateFailed: boolean;
}>;

/** `Cần hoàn thiện`: what a recipient could not see, each with a `Sửa` link when editable. */
export function IssuesPanel({ canEdit, items, templateFailed }: Props) {
  return (
    <section
      aria-labelledby="preview-issues-heading"
      className="rounded-3xl border border-rose-100 bg-white/90 p-5"
    >
      <h2 className="text-lg font-black text-stone-900" id="preview-issues-heading">
        Cần hoàn thiện
      </h2>
      {templateFailed ? (
        <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Mẫu quà gặp lỗi khi hiển thị. Người nhận sẽ thấy bản tĩnh với đầy đủ nội dung.
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="mt-3 text-sm font-semibold text-emerald-700">Không phát hiện vấn đề nào.</p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {items.map((item) => (
              <li
                className="flex items-center justify-between gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-stone-800"
                key={item.key}
              >
                <span>{item.message}</span>
                {item.href ? (
                  <Link className="font-bold text-rose-700 underline" href={item.href as Route}>
                    Sửa
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
          {canEdit ? null : (
            <p className="mt-3 text-sm text-stone-600">
              Mở Studio trên thiết bị đã tạo quà để sửa.
            </p>
          )}
        </>
      )}
    </section>
  );
}
