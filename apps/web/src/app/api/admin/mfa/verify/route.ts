import { adminMfaRouteDependencies } from "@/composition/admin";
import { handleAdminMfaVerify } from "@/modules/admin/presentation/admin-mfa-route-handlers";

export function POST(request: Request): Promise<Response> {
  return handleAdminMfaVerify(request, adminMfaRouteDependencies);
}
