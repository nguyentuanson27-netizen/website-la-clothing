export type AuthServerConfig = {
  secret: string;
  baseURL: string;
};

type ServerEnvironment = Readonly<Record<string, string | undefined>>;

const MIN_SECRET_LENGTH = 32;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

export function readAuthServerConfig(env: ServerEnvironment = process.env): AuthServerConfig {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.trim().length < MIN_SECRET_LENGTH) {
    throw new AuthConfigError(`BETTER_AUTH_SECRET must contain at least ${MIN_SECRET_LENGTH} characters`);
  }

  const baseURLInput = env.BETTER_AUTH_URL?.trim();
  if (!baseURLInput) {
    throw new AuthConfigError("BETTER_AUTH_URL must be configured on the server");
  }

  let url: URL;
  try {
    url = new URL(baseURLInput);
  } catch {
    throw new AuthConfigError("BETTER_AUTH_URL must be a valid absolute URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AuthConfigError("BETTER_AUTH_URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new AuthConfigError("BETTER_AUTH_URL must not contain credentials");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new AuthConfigError("BETTER_AUTH_URL must be an origin without a path, query, or fragment");
  }
  if (url.protocol !== "https:" && !LOCAL_HOSTNAMES.has(url.hostname)) {
    throw new AuthConfigError("BETTER_AUTH_URL must use HTTPS outside local development");
  }

  return {
    secret,
    baseURL: url.origin,
  };
}
