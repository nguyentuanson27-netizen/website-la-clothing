import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { createAdminRequestGuard } from "./admin-request.ts";
import { AuthorizationError } from "./authorization.ts";
import { auth } from "./server.ts";

const currentAdminGuard = createAdminRequestGuard({
  getRequestHeaders: async () => await headers(),
  getSession: ({ headers: requestHeaders }) =>
    auth.api.getSession({ headers: requestHeaders }),
});

export function requireCurrentAdmin() {
  return currentAdminGuard.requireAdmin();
}

export async function requireCurrentAdminPage() {
  try {
    return await requireCurrentAdmin();
  } catch (error) {
    if (!(error instanceof AuthorizationError)) {
      throw error;
    }

    if (error.code === "UNAUTHENTICATED") {
      redirect("/account");
    }

    notFound();
  }
}
