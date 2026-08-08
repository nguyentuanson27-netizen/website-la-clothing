# Spec v0.1 — LA Clothing E-commerce

Status: Approved by product owner on 2026-08-09.

## Objective
Build the official B2C e-commerce website for a men's fashion brand targeting men roughly 18–30, with a minimal/editorial/modern menswear visual language and mobile-first shopping UX.

## Core commerce contract
- Guest checkout is the default; account creation is optional.
- MVP payment method is COD.
- Products have Color × Size variants and stock is managed per variant.
- Pancake POS is the source of truth for product, SKU, variants, price, inventory, orders, and operational order status.
- The website owns editorial content, homepage composition, lookbook, SEO, customer website accounts, carts, mirrored/cache data, and sync state.
- Website orders are created in Pancake POS and Pancake status is synchronized back to the website.

## Storefront scope
- Homepage / campaign / new arrivals / collections / categories / search.
- Product listing with size, color, availability, price, and sort filters backed by URL state.
- Product detail with editorial gallery, color/size selector, stock state, size guide, care/shipping content, related products.
- Server-side anonymous cart identified by opaque cookie/cart ID.
- Guest COD checkout: name, phone, province/city, district, ward/commune, address detail, optional note.
- Guest order tracking with order code + phone, rate-limited with minimal disclosure.
- Optional customer account: login, profile, saved addresses, order history.

## Pancake integration
- Isolate raw Pancake API details under `src/integrations/pancake/`.
- Validate every external response before mapping to internal types.
- Never trust client-supplied price, stock, discount, or product metadata during checkout.
- Checkout must revalidate product/variant/price/stock server-side before order submission.
- Do not blindly retry uncertain order writes. Timeout-after-submit must support an explicit `SYNC_UNKNOWN` reconciliation state unless verified native idempotency exists.
- Use webhook-driven refresh where official contract supports it, plus scheduled/manual reconciliation as a safety net.

## UI direction
- Minimal × Editorial × Modern Menswear.
- Neutral palette: black, off-white, stone, grey, beige, olive.
- Strong typography, generous whitespace, large campaign photography.
- Avoid generic marketplace/dashboard look, gratuitous gradients, excessive rounded cards and shadows.
- Inspiration may come from modern fashion storefront patterns, but do not copy third-party logos, brand assets, photography, or proprietary identity.

## Proposed stack
- Next.js App Router + TypeScript + Tailwind CSS.
- PostgreSQL + Prisma.
- Secure server-side session authentication using a maintained auth library.
- Unit/integration tests plus a small Playwright E2E suite for critical flows.

## Security boundaries
- Pancake API keys stay server-side only.
- Validate browser input and Pancake output.
- Server-side authorization for admin and protected customer resources.
- Rate-limit login, checkout, and guest order lookup.
- Do not log secrets, passwords, full phone/address, or auth cookies.
- Webhooks require verified authentication/replay protection according to the official Pancake contract.

## MVP exclusions
Online payment, marketplace/multi-seller, native apps, custom POS/ERP, loyalty, phone OTP, custom carrier integration, international checkout, multi-currency, multi-language, AI recommendations.

## Success criteria
1. Pancake-backed product and variant inventory render correctly.
2. Out-of-stock variants cannot be purchased.
3. Guest COD checkout works without account creation.
4. A successful checkout creates exactly one Pancake order and persists its external ID.
5. Pancake order status is normalized and visible safely on the website.
6. Admin can manage editorial content without becoming a second operational POS.
7. Critical flows have automated tests, runtime verification, security review, accessibility review, and release/rollback evidence before launch.

## Open implementation questions
- Which Pancake warehouse(s) count as online stock.
- Shipping fee rule.
- Exact Pancake order status mapping.
- Pancake webhook event/auth/replay contract.
- Pancake create-order idempotency/reference capability.
