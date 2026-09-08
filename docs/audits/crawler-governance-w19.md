# W19 / U36 — Crawler Governance Matrix Audit & Verification

Status: **IMPLEMENTED**  
Branch: `feat/u36-crawler-governance`  
Base: `main@9bd8de464b339340cdcf47a08a3ee341e4b733e8`  
Governing specs:
- `docs/specs/la-clothing-owner-approved-facts-and-decisions.md` (§9)
- `docs/audits/seo-geo-audit.md` (W19 / P6 item 25)
- `tasks/growth-commerce-master-todo.md` (U36)

---

## 1. Context & Owner Decision

Audit item **W19** observed that crawler governance was previously monolithic: bots were either grouped or left to wildcard rules without distinguishing between traditional search crawlers, AI search assistants, foundation model training, or vendor-specific crawlers.

The repository owner reviewed the crawler distribution matrix and established the definitive policy:
**ALLOW ALL crawler categories across reviewed named crawlers + wildcard fallback.**

- `APPROVED_CRAWLER_CATEGORIES` / `ALL_APPROVED_NAMED_CRAWLERS`: defines the **currently reviewed explicit named crawler matrix** across 4 categories.
- Wildcard `*`: serves as the **fallback that enforces the owner-wide ALLOW policy for other compliant crawlers**.

### Purpose-Based Categories & Reviewed Explicit Named Crawlers

1. **Traditional Search Discovery & Indexing** (`traditionalSearch`):
   - `Googlebot` (Google search indexing & discovery)
   - `Bingbot` (Microsoft Bing search indexing)
2. **User-Driven AI Search & Retrieval** (`aiSearchAndRetrieval`):
   - `OAI-SearchBot` (OpenAI Search retrieval, SearchGPT)
   - `ChatGPT-User` (User-initiated browsing sessions in ChatGPT)
   - `Claude-SearchBot` (Anthropic search retrieval)
   - `Claude-User` (User-initiated retrieval in Claude)
   - `PerplexityBot` (Perplexity search & real-time citation retrieval)
3. **Autonomous AI Agents & Foundation Model Training** (`modelTraining`):
   - `GPTBot` (OpenAI model training & knowledge ingestion)
   - `ClaudeBot` (Anthropic training crawler)
   - `Google-Extended` (Google Gemini / Vertex AI model training)
   - `CCBot` (Common Crawl web corpus ingestion)
4. **Vendor-Specific Research & Ancillary Crawlers** (`vendorResearch`):
   - `GoogleOther` (Google non-search internal R&D and platform crawling)
5. **Wildcard Fallback** (`*`):
   - Standard fallback coverage enforcing owner-wide ALLOW policy for other compliant crawlers.

---

## 2. Safety Invariants & Guardrails

1. **Crawler Access != Search Indexing**:
   - Granting `Allow: /` to crawlers does **not** enable search indexing.
   - Organic search indexing remains strictly governed by `SEARCH_INDEXING_ENABLED` and the temporary-domain gate (`la.lanadesign.vn` remains fail-closed).
2. **Fail-Closed Indexing Contract**:
   - When indexing is disabled (`SEARCH_INDEXING_ENABLED !== "true"` or non-canonical host):
     - Sitemap (`/sitemap.xml`) is **withheld** (never advertised).
     - Public HTML routes remain crawlable (`Allow: /`) so search engines can read and respect the `<meta name="robots" content="noindex">` and `X-Robots-Tag: noindex` headers, preventing URL stranding.
     - Protected routes (`/api`) remain strictly blocked (`Disallow: /api`).
3. **Indexing Enabled Contract**:
   - When indexing is enabled:
     - Canonical sitemap (`https://<domain>/sitemap.xml`) is advertised.
     - Public HTML routes are allowed (`Allow: /`).
     - Protected routes (`/api`) remain blocked (`Disallow: /api`).
4. **Revert and Review Boundary**:
   - U36 is implemented in a dedicated branch and PR (`feat/u36-crawler-governance`) branching directly from `main@9bd8de464b339340cdcf47a08a3ee341e4b733e8`.
   - Independent from U33c (Size Guide).

---

## 3. Official Documentation References

- **Googlebot & Google-Extended & GoogleOther**:
  - Google Search Central: *Google crawlers and user-agents* (`https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers`)
  - Google-Extended: *Managing Google-Extended access* (`https://developers.google.com/search/docs/crawling-indexing/google-extended`)
- **Microsoft Bingbot**:
  - Bing Webmaster Tools: *Bingbot Crawling Guidelines* (`https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0`)
- **OpenAI (OAI-SearchBot, ChatGPT-User, GPTBot)**:
  - OpenAI Help Center: *OpenAI Web Crawlers Overview* (`https://platform.openai.com/docs/bots`)
- **Anthropic (Claude-SearchBot, Claude-User, ClaudeBot)**:
  - Anthropic Documentation: *Anthropic Crawlers & User-Agents* (`https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-it`)
- **Perplexity (PerplexityBot)**:
  - Perplexity Docs: *PerplexityBot Documentation* (`https://docs.perplexity.ai/docs/perplexitybot`)
- **Common Crawl (CCBot)**:
  - Common Crawl FAQ: *CCBot Crawling Guidelines* (`https://commoncrawl.org/faq`)

---

## 4. Implementation Details

- `src/seo/robots-policy.ts`:
  - Defined frozen dictionary `APPROVED_CRAWLER_CATEGORIES` grouping the 4 categories.
  - Defined frozen array `ALL_APPROVED_NAMED_CRAWLERS` enumerating all 12 named bots.
  - Implemented `buildRobotsDocument` generating explicit rules for `*` and every approved crawler with `allow: "/"` and `disallow: [...CRAWL_BLOCKED_PATHS]`.
  - Conditional inclusion of `sitemap` URL only when `exposure.indexingEnabled` is true.

---

## 5. Verification Evidence

1. **Domain Policy Tests**:
   - Command: `node --experimental-strip-types --test tests/domain/robots-policy.test.ts`
   - Verified:
     - All 4 categories and all 12 approved named crawlers in the current reviewed matrix are present.
     - Sitemap withheld when indexing disabled.
     - Explicit rules for wildcard fallback and all 12 reviewed crawlers.
     - Protected `/api` boundary enforced.
     - Sitemap advertised when indexing enabled.
     - P16C backwards compatibility maintained for `OAI-SearchBot`.
2. **Runtime HTTP Smoke Test**:
   - Command: `node --experimental-strip-types scripts/oai-robots-http-smoke.ts`
   - Spawns live Next.js development server on `127.0.0.1:3222`.
   - Requests `GET /robots.txt` over real HTTP.
   - Verified: HTTP 200, wildcard rule correct, all 12 user-agent sections explicitly formatted with `Allow: /` and `Disallow: /api`, and sitemap URL present under enabled indexing.
