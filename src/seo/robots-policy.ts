import type { MetadataRoute } from "next";

import {
  CRAWL_BLOCKED_PATHS,
  type SearchExposure,
} from "./search-exposure.ts";

/**
 * W19 / U36 — Owner-approved crawler governance matrix.
 *
 * Owner decision: ALLOW ALL categories across:
 * - traditional search discovery / indexing
 * - user-triggered retrieval / AI assistants
 * - model training crawlers
 * - vendor-specific crawlers
 *
 * Safety invariant:
 * ALLOW crawler does NOT mean enabling organic indexing.
 * When indexing is disabled, the canonical sitemap is withheld while keeping public HTML
 * crawlable for observable noindex tags and headers, keeping protected paths (/api) disallowed.
 */
export const APPROVED_CRAWLER_CATEGORIES = Object.freeze({
  traditionalSearch: Object.freeze({
    purpose: "Traditional search engine discovery and organic indexing",
    userAgents: Object.freeze(["Googlebot", "Bingbot"] as const),
  }),
  aiSearchAndRetrieval: Object.freeze({
    purpose: "Search features, AI assistants, and user-triggered retrieval",
    userAgents: Object.freeze([
      "OAI-SearchBot",
      "ChatGPT-User",
      "Claude-SearchBot",
      "Claude-User",
      "PerplexityBot",
    ] as const),
  }),
  modelTraining: Object.freeze({
    purpose: "Foundation model training and AI knowledge ingestion",
    userAgents: Object.freeze([
      "GPTBot",
      "ClaudeBot",
      "Google-Extended",
      "CCBot",
    ] as const),
  }),
  vendorResearch: Object.freeze({
    purpose: "Vendor-specific research and non-search product crawling",
    userAgents: Object.freeze(["GoogleOther"] as const),
  }),
});

export const ALL_APPROVED_NAMED_CRAWLERS = Object.freeze([
  ...APPROVED_CRAWLER_CATEGORIES.traditionalSearch.userAgents,
  ...APPROVED_CRAWLER_CATEGORIES.aiSearchAndRetrieval.userAgents,
  ...APPROVED_CRAWLER_CATEGORIES.modelTraining.userAgents,
  ...APPROVED_CRAWLER_CATEGORIES.vendorResearch.userAgents,
] as const);

export function buildRobotsDocument(exposure: SearchExposure): MetadataRoute.Robots {
  const rules: MetadataRoute.Robots["rules"] = [
    {
      userAgent: "*",
      allow: "/",
      disallow: [...CRAWL_BLOCKED_PATHS],
    },
    ...ALL_APPROVED_NAMED_CRAWLERS.map((userAgent) => ({
      userAgent,
      allow: "/",
      disallow: [...CRAWL_BLOCKED_PATHS],
    })),
  ];

  if (!exposure.indexingEnabled) {
    return { rules };
  }

  return {
    rules,
    sitemap: new URL("/sitemap.xml", exposure.origin).href,
  };
}
