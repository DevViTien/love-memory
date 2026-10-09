import type { Metadata } from "next";
import { headers } from "next/headers";

import { getAdminAccess } from "@/composition/admin";
import { templateVersionControls } from "@/composition/templates";
import { requireAdminPage } from "@/modules/admin/presentation/admin-guard";
import { getTemplateArtifact } from "@/modules/templates/infrastructure/template-artifact-registry";
import { AdminTemplateVersionsTable } from "@/modules/templates/presentation/admin-template-versions-table";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Mẫu quà",
};

/** Viewing the list is not recorded; each action is (`template-version-controls`). */
export default async function AdminTemplatesPage() {
  requireAdminPage(await getAdminAccess(await headers()));
  const versions = await templateVersionControls.listVersions();

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-black tracking-tight text-stone-900">Mẫu quà</h1>
      <p className="text-sm leading-6 text-stone-600">
        Tắt khẩn cấp làm mọi món quà dùng phiên bản đó chỉ hiện nội dung tĩnh và không xuất bản
        được, cho tới khi khôi phục. Phiên bản đã ngừng phát hành không quay lại danh mục.
      </p>
      <AdminTemplateVersionsTable
        versions={versions.map((version) => ({
          ...version,
          // The registry, not the kill: a killed version keeps its artifact for a restore.
          hasArtifact: getTemplateArtifact(version.templateId, version.version) !== null,
        }))}
      />
    </section>
  );
}
