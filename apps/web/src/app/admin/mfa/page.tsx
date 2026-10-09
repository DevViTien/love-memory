import type { Metadata } from "next";
import { headers } from "next/headers";

import { getAdminAccess } from "@/composition/admin";
import { AdminMfaForm } from "@/modules/admin/presentation/admin-mfa-form";
import { requireAdminForMfa } from "@/modules/admin/presentation/admin-guard";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Xác thực quản trị",
};

export default async function AdminMfaPage() {
  const access = requireAdminForMfa(await getAdminAccess(await headers()));
  const enrolled = access.session.user.twoFactorEnabled;

  return (
    <section className="mx-auto max-w-lg rounded-[2rem] border border-rose-100 bg-white/90 p-7 shadow-xl shadow-rose-100/60 sm:p-10">
      <h1 className="text-3xl font-black tracking-tight text-stone-900">
        {enrolled ? "Xác thực quản trị" : "Thiết lập xác thực hai lớp"}
      </h1>
      <p className="mt-3 leading-7 text-stone-600">
        Mỗi phiên đăng nhập cần xác thực lại bằng ứng dụng xác thực, và hết hạn sau 12 giờ.
      </p>
      <div className="mt-8">
        <AdminMfaForm enrolled={enrolled} />
      </div>
    </section>
  );
}
