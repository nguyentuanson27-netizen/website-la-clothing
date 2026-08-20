import { type NextRequest, NextResponse } from "next/server";

import { resolveConfiguredStorefrontProductSlug } from "@/commerce/storefront-catalog-runtime";

const SHOP_PRODUCT_PREFIX = "/shop/";

export async function proxy(request: NextRequest) {
  const slug = request.nextUrl.pathname.slice(SHOP_PRODUCT_PREFIX.length);
  const resolution = await resolveConfiguredStorefrontProductSlug(slug);

  if (resolution.kind === "CURRENT") {
    return NextResponse.next();
  }

  if (resolution.kind === "HISTORICAL") {
    return new Response(null, {
      status: 301,
      headers: {
        Location: `${SHOP_PRODUCT_PREFIX}${resolution.currentSlug}`,
      },
    });
  }

  return new Response("Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export const config = {
  matcher: "/shop/:slug",
};
