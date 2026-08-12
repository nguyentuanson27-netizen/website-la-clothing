# Pancake POS integration contract

Status: **catalog read contract is implemented and verified; fingerprinted raw OpenAPI evidence now establishes the reviewed C8 create-order structure, and PR #45 implements the server-only one-shot create-order core. Native idempotency/client-reference semantics, `cod` business semantics, browser submit wiring, and controlled live create-order verification remain separate gates.**

## Authoritative boundaries

- Production API base: `https://pos.pages.fm/api/v1`.
- `PANCAKE_API_KEY` and `PANCAKE_SHOP_ID` are server-only configuration.
- Browser code must never receive the Pancake API key or call privileged Pancake operations directly.
- External Pancake payloads are untrusted data and must be validated before crossing the adapter boundary.
- Raw Pancake field names stay under `src/integrations/pancake/`; storefront code consumes internal types only.

Catalog endpoints used by C3:

- `GET /shops/{SHOP_ID}/products/variations`
- `GET /shops/{SHOP_ID}/warehouses`

Later order/write-path work remains separate and must not be inferred from this catalog contract.

## Trusted structural discovery

Trusted discovery runs only on a local machine with ignored `.env.local` credentials:

```bash
pnpm pancake:contract:discover
```

The command refuses CI/GitHub Actions, never retains external scalar values, normalizes array indexes to `[]`, and records observed path/type unions. It fails closed on explicit traversal budgets instead of returning partial evidence.

The product-owner rerun after PR #37 returned:

```text
format: normalized-path-types-v1
complete: true
```

for both `productVariations` and `warehouses`, with no legacy `truncated` or `max-depth` markers.

Exact field names from trusted discovery are treated as sensitive inspection material. Do not persist raw discovery output or API responses in GitHub artifacts, public logs, issues, or commits.

## Reviewed catalog contract

`src/integrations/pancake/reviewed-contract-keys.ts` contains the checked-in object-key allowlists reviewed from the trusted discovery output.

`src/integrations/pancake/catalog-contract.ts` validates and maps only the C4-facing subset currently required:

### Product/variation page

- pagination: `page_number`, `page_size`, `total_entries`, `total_pages`;
- variation identity: `id`, `product_id`, `display_id`, `barcode`;
- attributes: `fields[].id`, `fields[].keyValue`, `fields[].name`, `fields[].value`;
- images: `images[]` as raw URL strings only;
- raw flags: `is_hidden`, `is_locked`;
- raw price fields: `retail_price`, `retail_price_after_discount`;
- parent identity/presentation: `product.id`, `product.name`;
- per-warehouse inventory: `variations_warehouses[].warehouse_id`, `variations_warehouses[].remain_quantity`.

The parser:

- requires a successful response;
- validates pagination as non-negative safe integers so later sync can traverse pages deliberately;
- requires `product_id === product.id`  instead of accepting inconsistent identities;
- validates the mapped field types without coercion;
- rejects duplicate `warehouse_id` rows rather than guessing whether they represent independent stock buckets;
- ignores unconsumed external fields at the internal mapped-output boundary.

`tests/fixtures/pancake/product-variations.json` and `tests/fixtures/pancake/warehouses.json` are synthetic/sanitized fixtures. They contain no live API key, real customer data, real operational inventory, or live shop identifiers.

### Semantics deliberately not invented by C3

The adapter preserves `is_hidden`, `is_locked`, `retail_price`, `retail_price_after_discount`, and attribute field values as reviewed raw contract data. C3 does **not** claim additional business semantics for those fields beyond what has been separately verified. Visibility policy, Color/Size interpretation, and final storefront price selection must be made explicitly in the slice that consumes them rather than being inferred silently from names.

Image strings are also data only. C3 does not fetch remote images. Any later server-side image fetch/render integration must apply an explicit trusted-origin policy before introducing an SSRF-capable fetch boundary.

## Verified all-warehouse stock semantics

The product owner decided:

> Website sellable inventory aggregates all Pancake warehouses for each variation.

No `PANCAKE_ONLINE_WAREHOUSE_IDS` subset is used. The former explicit-subset parser/config was removed because it no longer represents the approved business rule.

Trusted discovery observed these per-warehouse quantity fields as numbers:

- `actual_remain_quantity`
- `remain_quantity`
- `total_quantity`
- `pending_quantity`
- `waiting_quantity`
- `returning_quantity`

Field names alone were not used to choose sellable stock. PR #38 added a read-only local probe:

```bash
pnpm pancake:stock:probe <variation id | display_id | barcode>
```

The command refuses CI, reads only the product/variation endpoint, validates all six quantity fields, and never creates/updates/cancels an order.

The product owner then ran a controlled quantity-1 order lifecycle against the live shop:

| Field | A â†’ B after saving order | B â†’ C after cancellation |
| --- | ---: | ---: |
| `actual_remain_quantity` | 0 | 0 |
| `remain_quantity` | **-1** | **+1** |
| `total_quantity` | 0 | 0 |
| `pending_quantity` | 0 | 0 |
| `waiting_quantity` | 0 | 0 |
| `returning_quantity` | 0 | 0 |

Therefore the approved MVP `rule for the tested reservation lifecycle is:

```text
website sellable stock for a variation
= SUM(variations_warehouses[].remain_quantity across all distinct warehouses)
```

Mirrored stock is not a reservation. Checkout must re-read/revalidate authoritative Pancake availability immediately before order creation.

## Final reviewed-contract verification

The local verifier can now load the same ignored `.env.local` configuration:

```bash
pnpm pancake:contract:verify
```

The manual GitHub workflow `.github/workflows/pancake-contract-probe.yml` runs the same verifier with repository secrets when explicitly dispatched.

Verification has three defenses:

1. **Full allowlist validation** traverses every returned JSON node and rejects any object key not in the checked-in reviewed allowlist without echoing the unknown key.
2. **Mapped contract validation** runs the production catalog/warehouse parsers against the same live payload, validating the exact path/type subset C4 is allowed to consume, including pagination and all-warehouse `remain_quantity` aggregation.
3. **Bounded sanitized rendering** emits only reviewed field names/type shapes after validation; rendering limits cannot hide an unknown key because full validation runs first.

The full-tree allowlist validator uses a `250000`-node budget per endpoint and fails closed if the budget is exceeded.

On failure, the verifier prints only a fixed safe diagnostic code such as:

```text
Pancake reviewed-contract verification failed [stage=product-key-contract reason=inspection-budget] without logging external values or unknown field names
```

The stage distinguishes configuration, endpoint fetch, full-key validation, and mapped-contract validation for product variations vs warehouses. The reason distinguishes transport, unreviewed-field, inspection-budget, non-JSON, mapped-contract, or unexpected failure. It never echoes the API key, raw scalar values, raw payloads, or the name of an unreviewed external field.

**C3 does not become complete until this verifier passes against the current live shop payload and the resulting PR receives a clean human review.**

## C8 create-order contract verification

The current official Pancake POS Open API reference at `https://api-docs.pancake.biz/` establishes these structural facts:

- reference version `v1.0.0`;
- OpenAPI 3.1.0;
- production server `https://pos.pages.fm/api/v1`;
- Order Operations contains `POST /shops/{SHOP_ID}/orders`.

Endpoint existence alone is **not** treated as evidence for request/response semantics, a website-origin reference field, native idempotency, or the business meaning of optional monetary fields.

PR #43 added `src/integrations/pancake/order-openapi-contract.ts`, a pure local inspector for the create-order operation. It does not make network requests and does not need Pancake credentials. The inspector:

- locates exactly one `POST /shops/{...}/orders` operation without guessing the path-parameter name;
- resolves bounded local `#/...` references, including chained references;
- preserves the supported structural siblings of OpenAPI 3.1 Schema Object `$ref` values conjunctively rather than silently discarding them;
- rejects external references, unresolved references, circular references, malformed documents and inspection-budget overflow;
- uses one shared `10,000`-work-unit budget across externally controlled path entries, parameters, response entries, media types, schema nodes/arrays/properties, `$ref` hops and JSON-pointer segments so non-schema traversal cannot bypass the inspection ceiling;
- computes the effective OpenAPI parameter set by `(name, in)`, with operation-level parameters overriding matching path-level parameters; duplicate parameters within one level and path parameters without `required: true` fail closed;
- emits only structural contract metadata needed for review: parameter names/locations/required flags, schema types/formats/required property names/property structure, media types and response status structure;
- deliberately omits examples, defaults, descriptions and other external scalar sample values from its output.

The shared budget and effective-parameter rules were added after review comment `5251949190`. RED CI #432 kept 46/46 DBˆ\İËÙXİ\š]KØ]]‹[[™\XÚXÚÈÜ™Y[ˆ[™˜Z[Y^XİH™YH™]È™YÜ™\ÜÚ[ÛœÎˆ›Û‹\ØÚ[XH˜]™\œØ[YÙ]Ü\˜][Û‹[İ™\‹\]\˜[Y]\ˆİ™\œšYK[™X[›Ü›YY\XØ]KÛ›Û‹\™\]Z\™Y]\˜[Y]\œËˆÔ‘QSˆÛÛ[Z]˜™Y˜X\ÜÙYÒHÍÌÈÚ]‹Íˆˆ\İËÙXİ\š]KØ]]‹[\XÚXÚËMLKÌMLHÛXZ[‹Ú[YÜ˜][Ûˆ\İË›ÙXİ[ÛˆZ[[™YZ[‹XLL^K\[[YX‚‚•\È[œÜXİÜˆ\ÈH
Š™\ØÛİ™\KÜ™]šY]ÈZY›İÜš]H]]Üš^˜][ÛŠŠ‹ˆ][[[Û˜[HØ\\™\ÈÛ›HHİXİ\˜[İXœÙ]™YYYÈ[œÜXİHÜ\˜][ÛˆØY™[NÈ]Ù\È›İÛZ[HÈ™\Ù\™H]™\H”ÓÓˆØÚ[XKÓÜ[TH˜[Y][ÛˆÙ^]ÛÜ™‚‚”ˆÍ[ˆØ\\™YHš[™Ù\œš[Y˜]ÈÜ[THØİ[Y[›İYÚH›İ[™YØØ[]šY[˜ÙHÛÜšÙ›İÈØİ[Y[Y[ˆØÜËÚ[YÜ˜][ÛœËÜ[˜ØZÙK[Ü™\‹[Ü[˜\KY]šY[˜ÙK›YˆH]\›Z[š\İXÈÚXÚÙY\Y˜XİØÜËÚ[YÜ˜][ÛœËÜ[˜ØZÙK[Ü™\‹XÜ™X]KXÛÛ˜Xİ[ØœÙ\™YšœÛÛ˜\İX›\Ú\ÈHÜ™X]K[Ü™\ˆİXİ\˜[İXœÙ]\ÙYHÎ[˜ÛY[™Î‚‚‹H™\]Z\™Y\XØ][Û‹ÚœÛÛ˜Ù\]Y\İ›ÙNÂ‹HÜ[]™[™\]Z\™Y›Ü\HÚÜÚYÂ‹H][\Ö×X™\]Z\š[™È˜\šX][Û—ÚY[™]X[]XÂ‹H[YÙ\ˆ˜\šX][Û—Ú[™›Ëœ™]Z[ÜšXÙX[ˆH™]šY]ÙYİXœÙ]Â‹HÙ[XİYÚ\[™ËXY™\ÜÈšY[ÎÂ‹HØİ[Y[YŒ”ÓÓˆ™\ÜÛœÙHÚ][YÙ\ˆYY[]NÂ‹HÛÙ^\İÈİXİ\˜[H\È[ˆ
Š›Ü[Û˜[[YÙ\ŠŠ‹]H]šY[˜ÙHÙ\È›İ\İX›\ÚÚ]˜[YH]]\İ™\™\Ù[‚‚•\™Y›Ü™HˆÍHÙ\È›İ[™™\ˆÛÙHY\˜Ú[™\ÙHİXİ[
ÈÚ\[™È™YXÈHİšXİÜ™X]K[Ü™\ˆX\\ˆÛZ]ÈÛÙ[[\İYÙ[X[XÈ]šY[˜ÙH]]Üš^™\ÈH˜[YKˆHÙXœÚ]K[İÛ™YÚ\[™ÈÛXŞHX^Hİ[Ü[]HHÙ\\˜][H™]šY]ÙYÚ\[™×Ù™YXšY[È]ÛXŞH\È›İ]šY[˜ÙH›ÜˆÛÙÙ[X[XÜË‚‚ÍÈ[ÛÈ\œÚ\İÈHÛİ\˜ÙH[˜ØZÙTÚÜYÚ]]™\H™]ÈÚXÚÛİ]Û˜\ÚİˆÎ™\]Z\™\ÈH[[YHÙ\™\ˆÛÛ™šYİ\˜][ÛˆÈX]Ú]\œÚ\İYØÛÜH[™[ˆ\Ù\ÈH\œÚ\İY˜[YH›Üˆ]™H˜[Y][Ûˆ[™Ü™\ˆÜ™X][Û‹ˆHZYÜ˜][Ûˆ[X™\˜][HX]™\È™KY^\İ[™ÈÜ™\œÈÚ][˜ØZÙTÚÜYH•SÈÜÙH›İÜÈ˜Z[ÛÜÙYÚ]ÒÔÔĞÓÔWÕS•‘T’Q’QQ™XØ]\ÙHZ\ˆÜšYÚ[˜[ÚÜØ[››İ™H›İ™[‹ˆ^H\™H™]™\ˆ˜XÚÙš[Yœ›ÛHHİ\œ™[SĞRÑWÔÒÔÒQ‚‚“X[X[™]šY]ÈÙˆHš[™Ù\œš[YØİ[Y[İ[›İ[™›È\İÛÜH˜]]™HY[\İ[˜ŞHÙ^K[š\]Y[™\ÜÈİX\˜[YK™\]Y\İÚYÜˆ™\šYšYYÙXœÚ]K[ÜšYÚ[ˆ™Y™\™[˜ÙHÙ[X[XÜËˆXØÛÜ™[™ÛN‚‚‹HÈ›İ™X]İ\İÛWÚY\È[ˆY[\İ[˜ŞHÙ^NÂ‹HÈ›İ\™›Ü›HH›[™ÙXÛÛ™ÔÕY\ˆ[Y[İ]Û™]ÛÜšÈ[XšYİZ]NÂ‹HH\›İ™YÛ™K\Úİİ]HXXÚ[™H™[XZ[œÎˆ\˜X›HÔ×ÔÕP“RUS‘Ø™Y›Ü™HH™]ÛÜšÈØ[8¡¤ˆ^XİHÛ™HÔÕ][\8¡¤ˆYš[š]]™HİXØÙ\ÜÈÓÓ‘’T“QQØY™[HÛ\ÜÚYšXX›HØØ[™Z™Xİ[Ûˆ‘R‘PÕQ[XšYİ[İ\Èİ]ÛÛYHÖS×ÕS’Ó“ÕÓ˜Â‹H\XØ]K\ØY™H™]KÜ™XÛÛ˜Ú[X][Ûˆ™[XZ[œÈ›ØÚÙY[[H\İÛÜH[š\]YH™Y™\™[˜ÙKÚY[\İ[˜ŞHYXÚ[š\ÛH\ÈÙ\\˜][H™\šYšYY‚‚“›È]]ÛX]YÒH\İ\™›Ü›\ÈH]™H[˜ØZÙHÜ™X]K[Ü™\ˆÜš]KˆHÛÛ›ÛY]™HÜ™X]K[Ü™\ˆ™\šYšXØ][Ûˆ™[XZ[œÈHÙ\\˜]H[X[ˆØ]K‚‚ˆÈÈ]\ˆ[YÜ˜][ÛˆÛÛ˜XİÈİ[[™\šYšYY‚•\ÙH][\È™[XZ[ˆ[[[Û˜[H[™\šYšYYÜˆÙ\\˜][HØ]Y‚‚ŒKˆ\Ú[™\ÜÈÙ[X[XÜÈ›ÜˆÜ[Û˜[ÛÙÈˆÍHÛZ]È]˜]\ˆ[ˆİY\ÜÚ[™Ë‚Œ‹ˆÛÜœ™XİÙXœÚ]K[ÜšYÚ[‹ØÛY[\™Y™\™[˜ÙHšY[[™˜]]™HÜ™X]K[Ü™\ˆY[\İ[˜ŞHÜˆ[š\]YK\™Y™\™[˜ÙH™Z]š[Ü‹‚ŒËˆ^XİÜ™\ˆİ]\ÈÛÙ\Ëİ˜[œÚ][ÛœÈ\ÙYH™XÛÛ˜Ú[X][Û‹‚ˆÙXšÛÚÈ]™[˜[Y\Ë^[ØYÚ\K]][XØ][Û‹ÜÚYÛ˜]\™H[™™\^H›İXİ[Û‹‚Kˆœ›İÜÙ\ˆÚXÚÛİ]İX›Z]Ú\š[™È[™ÛÛ›ÛY]™HÜ™X]K[Ü™\ˆ™\šYšXØ][Û‹‚‚•HİY\İÚ\[™ËY™YHÛXŞH\ÈÙXœÚ]K[İÛ™Y[™Ø\È\›İ™YÙ\\˜][HHH›ÙXİİÛ™\ˆÛˆŒ‹LLLNˆÌ“‘HY˜][Ú]œ™YHÚ\[™ÈÚ[ˆ]]Üš]]]™HY\˜Ú[™\ÙHİXİ[\Èİ™\ˆK“‘Üˆİ[›ÙXİ]X[]H\È]X\İËˆ]\È›İ[ˆ[™\šYšYY[˜ØZÙHTHÛÛ˜Xİ‚‚‘È›İİY\ÜÈH™[XZ[š[™È[YÜ˜][ÛˆÛÛ˜XİËˆ[ˆ\Xİ[\‹È›İY›[™™]šY\È›Üˆ[˜Ù\Z[ˆ[˜ØZÙHÜ™\ˆÜš]\Ë‚‚ˆÈÈÙ™šXÚX[Ûİ\˜Ù\ÈÚXÚÙY‚‹H[˜ØZÙHÔÈ[Ü[ˆTH™Y™\™[˜ÙNˆÎ‹ËØ\KYØÜËœ[˜ØZÙK˜š^‹Â‹H[˜ØZÙHÔÈÜ[ˆTH™Y™\™[˜ÙH[NˆÎ‹ËÙØÜËœ[˜ØZÙK˜š^‹ÜÜËØ\KÙ[‹Â‹H[˜ØZÙHÔÈÜ[ˆTHİ™\šY]ÎˆÎ‹ËÙØÜËœ[˜ØZÙK˜š^‹ÜÜËÜİYŒLËÜİ\OÛ[™ÏY[‚‹HTHÙ^KØ]][XØ][ÛˆÎ‹ËÙØÜËœ[˜ØZÙK˜š^‹ÜÜËÜİYŒLËÜİ\Û[™ÏY[‚‹HÜ™\ˆİ]\È	ˆ›ØÙ\ÜÚ[™È›İÎˆÎ‹ËÙØÜËœ[˜ØZÙK˜š^‹ÜÜËÜİYŒLËÜİ\ÏÛ[™ÏY[‚‹HÜ[THËŒKŒÜXÚYšXØ][ÛˆÎ‹ËÜÜXË›Ü[˜\\Ë›Ü™ËÛØ\ËİŒËŒKŒ‹HœH[ˆ\™İ[Y[›ÜØ\™[™ÎˆÎ‹ËÜœKš[ËØÛKÜ[‚