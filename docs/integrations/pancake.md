# Pancake POS integration contract spike

Status: In progress — authoritative contract discovery before adapter implementation.

## Verified from official Pancake POS documentation

- Production base URL: `https://pos.pages.fm/api/v1`.
- Authentication uses an API key created in Pancake POS settings. The official examples send it as the `api_key` request parameter.
- Product/variation inventory can be read via `GET /shops/{SHOP_ID}/products/variations`.
- Product detail is available via `GET /shops/{SHOP_ID}/products/{PRODUCT_SKU}`.
- Warehouses are available via `GET /shops/{SHOP_ID}/warehouses`.
- Orders support list/create/get/update via:
  - `GET /shops/{SHOP_ID}/orders`
  - `POST /shops/{SHOP_ID}/orders`
  - `GET /shops/{SHOP_ID}/orders/{ORDER_ID}`
  - `PUT /shops/{SHOP_ID}/orders/{ORDER_ID}`
- Address vocabulary is exposed through province, district and commune endpoints.
- The Open API reference exposes a webhook configuration operation at `PUT /shops/{SHOP_ID}`.
- Pancake publishes a dedicated “Order status & processing flow” reference for `status` / `status_name` semantics.

## Security boundary

The website backend is the only caller allowed to possess the Pancake API key. Browser code must never receive the key or call privileged Pancake operations directly.

External Pancake payloads are untrusted data. The adapter must validate them before mapping to internal commerce types.

## Still unverified — blocks write-path implementation

The indexed official docs available in this build session do not expose enough detail to safely implement the following yet:

1. Exact `products/variations` response schema, including per-warehouse quantity fields and active/hidden flags.
2. Exact create-order request/response schema and the correct field for a website-origin reference.
3. Exact order status codes and all valid transitions.
4. Webhook event names, payload shape, authentication/signature and replay-protection mechanism.
5. Native create-order idempotency behavior or a unique client-reference constraint.
6. Which shop warehouse IDs should count toward online sellable inventory.

Do not guess these fields. Do not implement automatic retries for uncertain order writes until idempotency/reconciliation behavior is proven.

## Intended adapter boundary

Raw Pancake data will be isolated under `src/integrations/pancake/` and mapped to internal types used by storefront modules. No page/component should depend on raw Pancake field names.

## Official sources checked

- Pancake POS Open API overview/reference: https://docs.pancake.biz/pos/api/en/
- Pancake POS Open API overview: https://docs.pancake.biz/pos/st-f13/st-p1?lang=en
- API key/authentication: https://docs.pancake.biz/pos/st-f13/st-p2?lang=en
- Order status & processing flow: https://docs.pancake.biz/pos/st-f13/st-p3?lang=en
