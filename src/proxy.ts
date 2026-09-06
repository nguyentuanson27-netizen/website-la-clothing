import { type NextRequest, NextResponse } from "next/server";

import { resolveConfiguredStorefrontProductSlug } from "@/commerce/storefront-catalog-runtime";
import { readStorefrontOrigin } from "@/commerce/storefront-origin";
import { readSearchExposure, shouldNoIndexRequest } from "@/seo/search-exposure";

const SHOP_PRODUCT_PREFIX = "/shop/";
const EXACT_PRODUCT_PATH = /^\/shop\/[^/]+$/;
const NO_INDEX_VALUE = "noindex, nofollow";
/** Deliberately unroutable: it exists to be answered by the app's not-found page, never matched. */
const UNRESOLVED_PRODUCT_PATH = "/__unresolved-product";

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

  // An unresolvable slug is a 404, and it should look like this site saying so. Rewriting to a
  // path the app deliberately does not route hands the response to Next's own not-found
  // rendering, which answers 404 with the site's layout - so there is one 404 page here, not a
  // second one maintained in this file.
  //
  // Rewriting rather than falling through to /shop/[slug] is the point. The product page calls
  // notFound() itself, but src/app/shop/loading.tsx opens a Suspense boundary above it: the
  // response starts streaming before that call is reached and commits status 200, so an unknown
  // slug would answer with a soft 404 - measured on a production build, not assumed. Falling
  // through would also run the product lookup a second time and put the requested slug in the
  // streamed payload. The rewritten path carries neither.
  //
  // Next re-runs this proxy for the rewritten path, and that pass applies the search exposure
  // header too - so the wrapper here is redundant in outcome, and no test can tell the two
  // apart. It stays because all four exits of this function apply the header, and one exit that
  // silently relied on an internal rewrite for it would be the odd one out.
  return applySearchExposureHeader(
    request,
    NextResponse.rewrite(new URL(UNRESOLVED_PRODUCT_PATH, request.nextUrl.origin)),
  );
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
