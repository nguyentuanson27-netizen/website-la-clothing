import { type NextRequest, NextResponse } from "next/server";

import { resolveConfiguredStorefrontProductSlug } from "@/commerce/storefront-catalog-runtime";
import { readStorefrontOrigin } from "@/commerce/storefront-origin";
import { readSearchExposure, shouldNoIndexRequest } from "@/seo/search-exposure";

const SHOP_PRODUCT_PREFIX = "/shop/";
const EXACT_PRODUCT_PATH = /^\/shop\/[^/]+$/;
const NO_INDEX_VALUE = "noindex, nofollow";

function applySearchExposureHeader(request: NextRequest, response: Response): Response {
  const exposure = readSearchExposure();
  if (
    shouldNoIndexRequest({
      indexingEnabled: exposure.indexingEnabled,
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
    })
  ) {
    response.headers.set("X-Robots-Tag", NO_INDEX_VALUE);
  }
  return response;
}

export async function proxy(request: NextRequest) {
  if (!EXACT_PRODUCT_PATH.test(request.nextUrl.pathname)) {
    return applySearchExposureHeader(request, NextResponse.next());
  }

  const slug = request.nextUrl.pathname.slice(SHOP_PRODUCT_PREFIX.length);
  const resolution = await resolveConfiguredStorefrontProductSlug(slug);

  if (resolution.kind === "CURRENT") {
    return applySearchExposureHeader(request, NextResponse.next());
  }

  if (resolution.kind === "HISTORICAL") {
    const destination = new URL(readStorefrontOrigin());
    destination.pathname = `${SHOP_PRODUCT_PREFIX}${resolution.currentSlug}`;

    return applySearchExposureHeader(
      request,
      new Response(null, {
        status: 301,
        headers: {
          Location: destination.href,
        },
      }),
    );
  }

  return applySearchExposureHeader(
    request,
    new Response("Not Found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    }),
  );
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
