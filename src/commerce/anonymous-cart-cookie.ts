export const ANONYMOUS_CART_COOKIE_NAME = "la_cart";

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type CartCookieWrite = {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  expires?: Date;
  maxAge?: number;
};

type CartCookieReader = {
  get(name: string): { value: string } | undefined;
};

type CartCookieStore = CartCookieReader & {
  set(cookie: CartCookieWrite): void;
};

type AnonymousCartCookieSessionOptions = {
  production?: boolean;
};

type AnonymousCartCookie = {
  cartId: string;
  expiresAt: Date;
};

function isCanonicalCartId(value: string): boolean {
  return CANONICAL_UUID_PATTERN.test(value);
}

function baseCookieOptions(production: boolean) {
  return {
    name: ANONYMOUS_CART_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax",
    secure: production,
    path: "/",
  } as const;
}

export function readAnonymousCartCookie(store: CartCookieReader): string | null {
  const value = store.get(ANONYMOUS_CART_COOKIE_NAME)?.value;
  if (!value || !isCanonicalCartId(value)) {
    return null;
  }

  return value;
}

export function createAnonymousCartCookieSession(
  store: CartCookieStore,
  options: AnonymousCartCookieSessionOptions = {},
) {
  const production = options.production ?? process.env.NODE_ENV === "production";

  function read(): string | null {
    return readAnonymousCartCookie(store);
  }

  function write({ cartId, expiresAt }: AnonymousCartCookie): void {
    if (!isCanonicalCartId(cartId)) {
      throw new TypeError("Anonymous cart id must be a canonical UUID");
    }
    if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
      throw new TypeError("Anonymous cart expiry must be a valid timestamp");
    }

    store.set({
      ...baseCookieOptions(production),
      value: cartId,
      expires: expiresAt,
    });
  }

  function clear(): void {
    store.set({
      ...baseCookieOptions(production),
      value: "",
      maxAge: 0,
    });
  }

  return {
    read,
    write,
    clear,
  };
}
