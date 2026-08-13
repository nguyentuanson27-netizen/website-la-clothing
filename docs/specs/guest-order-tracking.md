# Spec — C10 Guest Order Tracking

Status: implementation slice derived from the approved LA Clothing e-commerce spec and existing T10/C10 tracker. Product-owner contract already requires guest tracking by order code + phone, rate limiting, and minimal disclosure.

## Objective
Provide a public guest-order lookup that lets a shopper verify the website-owned processing state of a COD order without creating an account.

## Assumptions / decisions
- Public route: `/track-order`.
- Proof is the exact server-stored guest phone plus the server-generated public order code; surrounding whitespace is ignored.
- Tracking is for guest orders only (`userId = null`).
- Public lookup does not call Pancake. It reads website-owned local order state and already-persisted order facts only.
- Pancake numeric status, Pancake IDs, `syncErrorCode`, name, phone, address, note, cart identity, and internal UUID are never returned to the browser.
- Website-owned public status mapping:
  - `DRAFT | VALIDATING | POS_SUBMITTING` → `PROCESSING`
  - `CONFIRMED` → `CONFIRMED`
  - `SYNC_UNKNOWN` → `CHECKING`
  - `REJECTED` → `REJECTED`
- Safe summary returned after proof: public order code, public status, order creation time, and total VND only.
- Rate-limit policy: 10 lookup attempts/minute per pseudonymous trusted client and 5 attempts/minute per HMAC-derived order-code bucket.
- Existing PostgreSQL `rateLimit` storage is reused; no migration or new dependency is required.

## Security / abuse model
Assets: guest PII, order existence, internal/Pancake identifiers, operational status, rate-limit identity.

Trust boundaries:
1. Browser FormData is untrusted.
2. Proxy-owned trusted client-IP header is converted to a pseudonymous HMAC key; raw IP is not persisted.
3. Public order code is HMAC-derived before use in rate-limit storage; raw code is not persisted in rate-limit keys.
4. Database lookup requires order code + phone in one predicate and returns an allowlisted projection only.

Abuse cases addressed:
- Guessing phones for a known order code → per-client + per-code rate limits.
- Enumerating valid order codes → wrong phone/nonexistent/malformed input all collapse to `NOT_FOUND`.
- PII scraping → successful response excludes all customer/address fields.
- Internal integration leakage → no raw Pancake status/IDs/errors are exposed.
- Public lookup causing third-party amplification → no Pancake network call is performed.

## Commands
- Domain/integration: `pnpm test`
- Database: `pnpm test:db`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
- Build: `pnpm build`
- Full CI: GitHub Actions `.github/workflows/ci.yml`

## Project structure
- Domain/service boundary: `src/commerce/guest-order-tracking*.ts`
- Server Action: `src/commerce/guest-order-tracking-actions.ts`
- UI: `src/components/commerce/guest-order-tracking-form.tsx`, `src/app/track-order/page.tsx`
- Tests: `tests/domain/`, `tests/database/`, existing Playwright checkout runtime.

## Boundaries
Always:
- Validate and bound all browser input.
- Consume client rate limit before database lookup.
- Use generic public failure shapes.
- Keep output allowlisted and free of PII/internal identifiers.

Ask first:
- Any new persisted PII.
- Any change to auth/session model.
- Any public Pancake status-code semantics or status-to-`LocalOrderState` mapping.

Never:
- Log submitted phone/order code.
- Return full customer/address data.
- Store raw IP or raw public order code in rate-limit keys.
- Trigger Pancake writes or retries from tracking.

## Success criteria
1. Correct order code + phone returns only the safe tracking summary.
2. Wrong phone, nonexistent order, malformed input, and non-guest order do not disclose order existence.
3. Public status is derived only from website-owned `LocalOrderState`.
4. Client and order-code rate limits are atomic, bounded, and store pseudonymous/HMAC keys only.
5. `/track-order` is keyboard-accessible, labelled, mobile-safe, and passes the existing Axe runtime gate.
6. Existing tests, lint, typecheck, production build, and browser/VoiceOver/Axe CI remain green.

## Explicitly out of scope
- Pancake status business meanings/transition mapping.
- Webhooks or scheduler cadence.
- Customer account order history.
- SMS/OTP.
- Editing/cancelling orders from the tracking page.
