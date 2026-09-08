import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_APPROVED_NAMED_CRAWLERS,
  APPROVED_CRAWLER_CATEGORIES,
  buildRobotsDocument,
} from "../../src/seo/robots-policy.ts";

const publicOrigin = "https://shop.example.com";

test("U36 crawler governance matrix covers reviewed named crawlers across owner-approved categories", () => {
  // Traditional search
  assert.deepEqual(APPROVED_CRAWLER_CATEGORIES.traditionalSearch.userAgents, [
    "Googlebot",
    "Bingbot",
  ]);

  // AI Search & user-triggered retrieval
  assert.deepEqual(APPROVED_CRAWLER_CATEGORIES.aiSearchAndRetrieval.userAgents, [
    "OAI-SearchBot",
    "ChatGPT-User",
    "Claude-SearchBot",
    "Claude-User",
    "PerplexityBot",
  ]);

  // Model training
  assert.deepEqual(APPROVED_CRAWLER_CATEGORIES.modelTraining.userAgents, [
    "GPTBot",
    "ClaudeBot",
    "Google-Extended",
    "CCBot",
  ]);

  // Vendor research
  assert.deepEqual(APPROVED_CRAWLER_CATEGORIES.vendorResearch.userAgents, [
    "GoogleOther",
  ]);

  // Total named crawlers in current reviewed matrix
  assert.equal(ALL_APPROVED_NAMED_CRAWLERS.length, 12);
});

test("U36 robots policy is fail-closed on indexing and explicit on reviewed crawlers when indexing is disabled", () => {
  const doc = buildRobotsDocument({ origin: publicOrigin, indexingEnabled: false });

  // Sitemap must be withheld while indexing is disabled
  assert.equal("sitemap" in doc && doc.sitemap !== undefined, false, "sitemap must not be advertised when indexing is disabled");

  assert.ok(Array.isArray(doc.rules));
  const rules = doc.rules;

  // Wildcard rule exists as fallback enforcing owner-wide ALLOW for compliant crawlers
  const wildcard = rules.find((r) => r.userAgent === "*");
  assert.ok(wildcard, "wildcard * rule must exist");
  assert.equal(wildcard.allow, "/");
  assert.deepEqual(wildcard.disallow, ["/api"]);

  // Every approved named agent in current reviewed matrix has an explicit rule
  for (const userAgent of ALL_APPROVED_NAMED_CRAWLERS) {
    const rule = rules.find((r) => r.userAgent === userAgent);
    assert.ok(rule, `explicit rule for ${userAgent} must exist`);
    assert.equal(rule.allow, "/", `${userAgent} must be allowed on public storefront`);
    assert.deepEqual(rule.disallow, ["/api"], `${userAgent} must be disallowed on /api`);
  }

  // Fail-closed safety invariant: no crawler rule ever permits /api
  for (const rule of rules) {
    assert.equal(rule.allow, "/");
    assert.deepEqual(rule.disallow, ["/api"]);
  }
});

test("U36 robots policy advertises canonical sitemap and preserves crawler access for reviewed crawlers + wildcard when indexing is enabled", () => {
  const doc = buildRobotsDocument({ origin: publicOrigin, indexingEnabled: true });

  // Sitemap must be advertised on canonical origin
  assert.equal(doc.sitemap, "https://shop.example.com/sitemap.xml");

  assert.ok(Array.isArray(doc.rules));
  const rules = doc.rules;

  // Wildcard rule exists
  const wildcard = rules.find((r) => r.userAgent === "*");
  assert.ok(wildcard, "wildcard * rule must exist");
  assert.equal(wildcard.allow, "/");
  assert.deepEqual(wildcard.disallow, ["/api"]);

  // Every approved named agent has an explicit rule
  for (const userAgent of ALL_APPROVED_NAMED_CRAWLERS) {
    const rule = rules.find((r) => r.userAgent === userAgent);
    assert.ok(rule, `explicit rule for ${userAgent} must exist`);
    assert.equal(rule.allow, "/");
    assert.deepEqual(rule.disallow, ["/api"]);
  }
});

test("P16C backwards compatibility: OAI-SearchBot remains on the reviewed public crawl boundary", () => {
  const disabled = buildRobotsDocument({ origin: publicOrigin, indexingEnabled: false });
  const enabled = buildRobotsDocument({ origin: publicOrigin, indexingEnabled: true });

  for (const doc of [disabled, enabled]) {
    const rules = Array.isArray(doc.rules) ? doc.rules : [];
    const oai = rules.find((r) => r.userAgent === "OAI-SearchBot");
    assert.ok(oai, "OAI-SearchBot rule must exist");
    assert.equal(oai.allow, "/");
    assert.deepEqual(oai.disallow, ["/api"]);
  }
});

