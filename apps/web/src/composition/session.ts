import { createSessionService } from "@/modules/auth/application/session";
import { getAuth } from "@/composition/auth";

export const { getCurrentUser, verifySession } = createSessionService({
  async getSession(requestHeaders) {
    const auth = await getAuth();
    return auth.api.getSession({ headers: requestHeaders });
  },
});
