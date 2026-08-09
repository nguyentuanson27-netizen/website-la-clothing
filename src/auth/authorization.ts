export type AuthorizationErrorCode = "UNAUTHENTICATED" | "FORBIDDEN";

type AuthSessionLike = {
  user: {
    id: string;
    role?: string | null;
  };
  session: {
    id: string;
  };
};

export class AuthorizationError extends Error {
  readonly code: AuthorizationErrorCode;

  constructor(code: AuthorizationErrorCode) {
    super(code === "UNAUTHENTICATED" ? "Authentication is required" : "Access is forbidden");
    this.name = "AuthorizationError";
    this.code = code;
  }
}

export function requireAuthenticatedSession<TSession extends AuthSessionLike>(
  session: TSession | null | undefined,
): TSession {
  if (!session) {
    throw new AuthorizationError("UNAUTHENTICATED");
  }

  return session;
}

export function requireAdminSession<TSession extends AuthSessionLike>(
  session: TSession | null | undefined,
): TSession {
  const authenticatedSession = requireAuthenticatedSession(session);

  if (authenticatedSession.user.role !== "ADMIN") {
    throw new AuthorizationError("FORBIDDEN");
  }

  return authenticatedSession;
}
