import { adminMfaRouteDependencies } from "@/composition/admin";
import { handleAdminMfaEnroll } from "@/modules/admin/presentation/admin-mfa-route-handlers";

export function POST(request: Request): Promise<Response> {
  return handleAdminMfaEnroll(request, adminMfaRouteDependencies);
}
