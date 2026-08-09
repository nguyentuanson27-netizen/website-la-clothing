import { headers } from "next/headers";

import { createAdminRequestGuard } from "./admin-request.ts";
import { auth } from "./server.ts";

const currentAdminGuard = createAdminRequestGuard({
  getRequestHeaders: async () => await headers(),
  getSession: ({ headers: requestHeaders }) =>
    auth.api.getSession({ headers: requestHeaders }),
});

export function requireCurrentAdmin() {
  return currentAdminGuard.requireAdmin();
}
