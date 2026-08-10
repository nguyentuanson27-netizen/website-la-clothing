import { requireAdminSession } from "./authorization.ts";

type AdminSessionCandidate =
  | {
      user: {
        id: string;
        role?: string | null;
      };
      session: {
        id: string;
      };
    }
  | null
  | undefined;

type AdminRequestGuardDependencies = {
  getRequestHeaders(): Promise<Headers>;
  getSession(input: { headers: Headers }): Promise<AdminSessionCandidate>;
};

export function createAdminRequestGuard({
  getRequestHeaders,
  getSession,
}: AdminRequestGuardDependencies) {
  async function requireAdmin() {
    const requestHeaders = await getRequestHeaders();
    const session = await getSession({ headers: requestHeaders });
    return requireAdminSession(session);
  }

  return { requireAdmin };
}
