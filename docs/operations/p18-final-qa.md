# P18 final QA runtime

P18 is the final visual/search/E2E gate in FINAL PLAN V2. It remains downstream of P17 live catalog/media/content acceptance and must not be treated as complete until the trusted real-shop P17 acceptance report is ready.

## What this runtime proves

`.github/workflows/p18-final-qa.yml` builds the production application, deploys migrations into an isolated PostgreSQL service, seeds a representative public product, starts `next start`, and runs `tests/a11y-runtime/p18-final-qa.spec.ts` in Chromium.

The runtime verifies:

- representative `/`, `/shop`, and `/shop/<slug>` production pages at 390×844 and 1440×900;
- no horizontal overflow and no WCAG A/AA Axe violations on those pages;
- keyboard focus can enter each representative page;
- staging/local search exposure remains fail-closed (`noindex`, no canonical, no sitemap advertising/URLs);
- `robots.txt` keeps `/api` blocked and keeps `OAI-SearchBot` on the reviewed public crawl boundary;
- the representative PDP emits factual parent Product/Offer JSON-LD;
- production navigation timing evidence is emitted for home/PLP/PDP on mobile and desktop.

## Performance evidence contract

Each measured navigation emits one log line prefixed with:

`P18_PERFORMANCE_EVIDENCE`

The JSON payload contains:

- viewport (`mobile` or `desktop`);
- route (`home`, `plp`, or `pdp`);
- server response start / TTFB timing;
- DOMContentLoaded timing;
- load timing;
- first-contentful-paint timing;
- document/resource transfer sizes and resource count.

This first P18 slice records comparable baseline evidence; it does **not** invent CI performance budgets before measuring the current production build on the hosted runner. If a regression budget is added later, it must be derived from repeated comparable measurements with enough margin for runner variance.

The test mocks only Next image optimizer responses with a tiny local JPEG so the evidence is deterministic and does not measure Pancake CDN/network variance. Real final-domain/CDN latency remains a P19 post-cutover observation.

## Relationship to existing gates

This workflow does not replace:

- the full `CI` verify job (DB/security/lint/typecheck/domain/build/release/start);
- the macOS Playwright/Axe/VoiceOver suite;
- Catalog indexation runtime;
- VPS container verification;
- trusted `pnpm pancake:catalog:accept` on the authorized real-shop host.

P18 can be considered complete only when the FINAL PLAN V2 checklist is satisfied together, including 0 Critical / 0 Required review findings.

## Rollback

This slice changes only QA automation/docs. Rollback is removal/revert of the P18 workflow, Playwright config/spec, and this runbook. It does not change production schema or application behavior.
