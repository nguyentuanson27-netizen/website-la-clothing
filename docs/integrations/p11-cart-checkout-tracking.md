# P11: Cart, Checkout, and Order Tracking Polish

## Overview

Task P11 polishes the buyer-facing shopping cart, guest COD checkout, checkout success confirmation, and order tracking experiences. It ensures a consistent launch visual system, explicit loading/empty/error states, strict server authority over pricing, stock, shipping calculation, and order submission, and zero horizontal overflow on mobile (390px) and desktop.

---

## Key Architecture & Design

### 1. Shopping Bag (`/cart`)
- **Breadcrumb Navigation**: Semantic breadcrumb (`Trang chủ` → `Túi hàng`) with accessible keyboard focus rings.
- **Product Photography**: Renders trusted product media (`line.media.primary`) via Next.js `Image` component with responsive sizes and smooth hover zoom, falling back to a clean branded geometric placeholder when media is absent.
- **Item Controls**: Clear variant attributes (`Color / Size`), quantity modification (`CartLineControls`), live line total, and availability status badge.
- **Empty State**: Explicit `data-ui-state="empty"` container with "Túi hàng của bạn đang trống" and direct call-to-action link back to the catalog (`/shop`).
- **Server Authority**: Line subtotals and availability are computed server-side via `getCurrentStorefrontCartLines()`; unavailable lines are excluded from subtotal calculations with clear actionable error messages.

### 2. Guest COD Checkout (`/checkout`)
- **Breadcrumb Navigation**: Semantic breadcrumb (`Trang chủ` → `Túi hàng` → `Thanh toán`).
- **Order Summary Sidebar**: Visual order line items with trusted product thumbnail photography, line pricing, and server-calculated shipping fee summary.
- **Geo Cascading**: Robust province → district → commune cascading selector with fail-closed retry handling for network glitches.
- **Fail-Closed Validation**: Zero browser authority over prices, shipping rules, or Pancake identifiers. All validation and rate-limiting occur strictly server-side.
- **Empty / Stale Bag Guards**: Renders an explicit `data-ui-state="empty"` alert when the bag is empty or requires re-verification.

### 3. Checkout Success (`/checkout/success`)
- **Breadcrumb Navigation**: Semantic breadcrumb (`Trang chủ` → `Đặt hàng thành công`).
- **Order Confirmation**: High-contrast order confirmation badge showing the public order code (`LA-...`), next steps (customer service phone confirmation before delivery), and quick links to `/track-order`, `/shop`, and `/`.
- **Cart Cookie Teardown**: Seamless cleanup of the `la_cart` cookie upon successful order confirmation.

### 4. Order Tracking (`/track-order`)
- **Breadcrumb Navigation**: Semantic breadcrumb (`Trang chủ` → `Tra cứu đơn hàng`).
- **Secure Lookup**: Fast lookup by public order code and guest phone number; strictly excludes customer PII, street address, or internal shop secrets from the public response.
- **State Badges**: Semantic status display (`Đang xử lý`, `Đã tiếp nhận`, `Đang xác minh`, `Không thể hoàn tất`) with `data-ui-state="success"` or `data-ui-state="empty"` attributes.

---

## Verification Evidence

- `tests/domain/storefront-cart.test.ts`: PASS (verifies trusted product media resolution and server-authoritative cart line building).
- `tests/database/storefront-cart.test.ts`: PASS (verifies database mirror product media retrieval and stock boundary constraints).
- `tests/a11y-runtime/checkout.spec.ts`: PASS (verifies geo cascading, COD order submission, empty state rendering, and WCAG 2.1 AA accessibility).
- `tests/a11y-runtime/tracking.spec.ts`: PASS (verifies secure order lookup without PII leakage, rate limiting, and WCAG 2.1 AA compliance).
- `tests/a11y-runtime/storefront-commerce.spec.ts`: PASS (verifies end-to-end buyer journey: PDP selection → Bag update → Checkout navigation across both 390px mobile and 1440px desktop viewports, with full PDP/Cart/Checkout/Success/Tracking layout verification, 0 Axe violations, and 0 horizontal overflow).

