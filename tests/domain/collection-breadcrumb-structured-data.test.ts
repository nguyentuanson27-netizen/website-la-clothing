import assert from "node:assert/strict";
import test from "node:test";

import { buildCollectionBreadcrumbStructuredData } from "../../src/seo/collection-breadcrumb-structured-data.ts";
import { shouldNoIndexRequest } from "../../src/seo/search-exposure.ts";

test("U6a collection BreadcrumbList mirrors the visible breadcrumb from the server-owned origin", () => {
  assert.deepEqual(
    buildCollectionBreadcrumbStructuredData({
      origin: "https://shop.example.com",
      title: "City Uniform",
    }),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Trang chủ",
          item: "https://shop.example.com/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Bộ sưu tập",
          item: "https://shop.example.com/collections",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "City Uniform",
        },
      ],
    },
  );
});

test("U6a keeps every unapproved support candidate outside enabled search exposure", () => {
  for (const pathname of ["/about", "/size-guide", "/shipping-returns", "/faq"]) {
    assert.equal(
      shouldNoIndexRequest({ indexingEnabled: true, pathname, search: "" }),
      true,
      `${pathname} must remain noindex without route-level content approval`,
    );
    assert.equal(
      shouldNoIndexRequest({ indexingEnabled: true, pathname, search: "?ref=test" }),
      true,
      `${pathname} query states must remain noindex`,
    );
  }
});
