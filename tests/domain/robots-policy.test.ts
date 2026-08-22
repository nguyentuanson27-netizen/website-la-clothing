import assert from "node:assert/strict";
import test from "node:test";

import { buildRobotsDocument } from "../../src/seo/robots-policy.ts";

const publicOrigin = "https://shop.example.com";

const expectedRules = [
  {
    userAgent: "*",
    allow: "/",
    disallow: ["/api"],
  },
  {
    userAgent: "OAI-SearchBot",
    allow: "/",
    disallow: ["/api"],
  },
];

test("P16C robots policy keeps OAI-SearchBot on the reviewed public crawl boundary", () => {
  assert.deepEqual(
    buildRobotsDocument({ origin: publicOrigin, indexingEnabled: false }),
    { rules: expectedRules },
  );
  assert.deepEqual(
    buildRobotsDocument({ origin: publicOrigin, indexingEnabled: true }),
    {
      rules: expectedRules,
      sitemap: "https://shop.example.com/sitemap.xml",
    },
  );
});
