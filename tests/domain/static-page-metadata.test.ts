/**
 * U30b / W10 — self-canonical for the three static indexable pages.
 *
 * The audit names `/`, `/collections` and `/lookbook` and nothing else. `/shop`, `/collections/<slug>`
 * and their pagination already answer to `buildCatalogListingMetadata`, PDPs answer to
 * `buildStorefrontProductMetadata`, and none of those contracts is this one's to change.
 *
 * Two properties matter more than the happy path. The canonical must come from the origin the
 * server owns, never from anything a request can set; and when indexing is off it must not appear
 * at all, because a canonical is a statement about an indexable URL.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildStaticPageMetadata } from "../../src/seo/static-page-metadata.ts";

const ORIGIN = "https://shop.example.com";

function canonical(metadata: ReturnType<typeof buildStaticPageMetadata>): string | null {
  const value = metadata.alternates?.canonical;
  if (typeof value === "string") return value;
  if (value instanceof URL) return value.toString();
  return null;
}

test("U30b emits self-canonical for each approved static page when indexing is enabled", () => {
  for (const [pathname, expected] of [
    // Next renders the root canonical without a trailing slash, and this is asserted against what
    // the page serves rather than against what `new URL()` happens to produce.
    ["/", ORIGIN],
    ["/collections", `${ORIGIN}/collections`],
    ["/lookbook", `${ORIGIN}/lookbook`],
  ] as const) {
    assert.equal(
      canonical(
        buildStaticPageMetadata({
          origin: ORIGIN,
          indexingEnabled: true,
          pathname,
          searchParams: {},
        }),
      ),
      expected,
      `${pathname} must be its own canonical`,
    );
  }
});

test("U30b withholds the canonical entirely when indexing is disabled", () => {
  // The existing exposure contract withholds canonical under noindex — a canonical names a URL a
  // crawler should prefer, which is meaningless for a page it is told not to index. W10 must not
  // become the one place that leaks one.
  for (const pathname of ["/", "/collections", "/lookbook"] as const) {
    assert.equal(
      canonical(
        buildStaticPageMetadata({
          origin: ORIGIN,
          indexingEnabled: false,
          pathname,
          searchParams: {},
        }),
      ),
      null,
      `${pathname} must withhold canonical under noindex`,
    );
  }
});

test("U30b withholds the canonical when the request carries any query string", () => {
  // `/shop?colour=black` already withholds rather than canonicalising to a URL the visitor did not
  // ask for, and `shouldNoIndexRequest` already marks these query URLs noindex. Emitting an
  // indexable hint on a page the policy says not to index would contradict both.
  for (const searchParams of [{ q: "shirt" }, { page: "2" }, { utm_source: "newsletter" }]) {
    assert.equal(
      canonical(
        buildStaticPageMetadata({
          origin: ORIGIN,
          indexingEnabled: true,
          pathname: "/collections",
          searchParams,
        }),
      ),
      null,
    );
  }
});

test("U30b canonicalises no path outside the three the audit names", () => {
  // /shop, /collections/<slug>, PDPs and search each have an owner already. This builder is not a
  // second authority over any of them.
  for (const pathname of [
    "/shop",
    "/collections/summer-shirts",
    "/shop/ao-oxford-relaxed",
    "/search",
    "/cart",
    "/checkout",
    "/lookbook/extra",
    "/collections/",
  ] as const) {
    assert.equal(
      canonical(
        buildStaticPageMetadata({
          origin: ORIGIN,
          indexingEnabled: true,
          pathname,
          searchParams: {},
        }),
      ),
      null,
      `${pathname} is owned elsewhere and must get no canonical from here`,
    );
  }
});

test("U30b builds the canonical from the server-owned origin it is given, not from any request input", () => {
  // The origin arrives from `readSearchExposure()`, which reads server configuration. Proving the
  // builder simply follows its input is what keeps a `Host` header out of the canonical: there is
  // no other source for it to prefer.
  assert.equal(
    canonical(
      buildStaticPageMetadata({
        origin: "https://la.lanadesign.vn",
        indexingEnabled: true,
        pathname: "/lookbook",
        searchParams: {},
      }),
    ),
    "https://la.lanadesign.vn/lookbook",
  );
});

test("U30b passes through the title and description a route already declares", () => {
  const metadata = buildStaticPageMetadata({
    origin: ORIGIN,
    indexingEnabled: true,
    pathname: "/collections",
    searchParams: {},
    title: "Bộ sưu tập",
    description: "Khám phá các bộ sưu tập từ LA Clothing.",
  });

  assert.equal(metadata.title, "Bộ sưu tập");
  assert.equal(metadata.description, "Khám phá các bộ sưu tập từ LA Clothing.");
});

test("U30b adds no title or description of its own where a route declares none", () => {
  // The homepage inherits both from the root metadata. Inventing them here would silently take
  // that over.
  const metadata = buildStaticPageMetadata({
    origin: ORIGIN,
    indexingEnabled: true,
    pathname: "/",
    searchParams: {},
  });

  assert.equal("title" in metadata, false);
  assert.equal("description" in metadata, false);
});

test("U30b adds no robots, Open Graph or Twitter metadata of its own", () => {
  // Robots is the exposure gate's answer and the social card is the root fallback's. A canonical
  // builder that also emitted either would become a second authority over both.
  const metadata = buildStaticPageMetadata({
    origin: ORIGIN,
    indexingEnabled: true,
    pathname: "/",
    searchParams: {},
  });

  assert.equal("robots" in metadata, false);
  assert.equal("openGraph" in metadata, false);
  assert.equal("twitter" in metadata, false);
});
