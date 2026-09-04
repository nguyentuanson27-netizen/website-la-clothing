# Kiểm toán SEO/GEO

Thực hiện tại commit `31f88b3`. Phạm vi đọc: `src/seo/`, `src/app/`, `src/proxy.ts`,
`src/commerce/storefront-product.ts`, `src/content/`, `src/components/`, `prisma/schema.prisma`,
`scripts/`, `.github/workflows/`, `docs/`. Không có thay đổi mã nguồn nào kèm theo tài liệu này.
Các nhận định về hành vi runtime được suy ra từ mã nguồn và test; Core Web Vitals và hành vi
production chưa được đo trực tiếp.

Các khuyến nghị phụ thuộc Google Search/structured data được đối chiếu lại với tài liệu chính thức
ngày 2026-08-30. Tài liệu này là **audit + planning input**, không phải implementation plan.

## Kết luận

Nền tảng kỹ thuật SEO của repo tốt: cấu hình indexation fail-closed khi thiếu/invalid flag,
canonical lấy từ origin tin cậy, 301 cho slug lịch sử, policy phân trang chống duplicate, sitemap
lọc URL không hợp lệ và nhiều contract SEO đã có test. Tuy nhiên temporary production domain hiện
chỉ được giữ noindex bằng policy/ADR, chưa có hard block tương ứng trong code. Điểm yếu lớn nhất trước khi mở index không nằm ở một "GEO hack", mà ở
ba lớp cơ bản:

1. **Correctness thương mại:** sale price hiện bị coi là unresolved; variant URL/deep-link contract
   chưa tồn tại; structured data chưa mô hình đúng product variants có giá khác nhau.
2. **Search presentation + regression safety:** metadata PDP còn nhét slug/path kỹ thuật; năm
   dedicated SEO HTTP smoke chưa được wire trực tiếp, dù CI đã có overlapping domain/runtime coverage.
3. **First-party content + commerce discovery:** thiếu các trang evergreen có thẩm quyền về brand,
   đổi trả, vận chuyển, size và liên hệ; nhưng các policy/fact đó cũng chưa có đủ source-of-truth
   để coding agent được phép tự tạo nội dung.

`SEARCH_INDEXING_ENABLED=false` trên domain tạm là **release gate có chủ đích theo ADR 0004, không
phải bug cần "fix"**. Không bật index cho `la.lanadesign.vn`; chỉ mở index sau khi domain vĩnh viễn
được xác nhận và có phê duyệt human riêng.

### Assessment rubric

Không dùng điểm số 1–10 vì audit hiện không có rubric định lượng đủ chặt; số điểm dễ tạo false
precision. Các trạng thái dưới đây có nghĩa:

- **Strong** — contract chính đã có, code/test evidence rõ, chỉ còn enhancement hoặc runtime proof.
- **Partial** — có nền tảng nhưng còn gap đáng kể trước khi coi là production-ready cho search.
- **Gap** — thiếu capability/content/verification quan trọng.
- **Unverified** — source code có tín hiệu tốt nhưng chưa có runtime/field evidence phù hợp.

| Hạng mục | Đánh giá |
| --- | --- |
| Kiến trúc & mã nguồn SEO | **Strong** |
| Kiểm soát index & crawl (thiết kế) | **Strong** |
| Performance implementation readiness | **Strong** |
| Core Web Vitals thực tế | **Unverified** |
| Kiểm thử & CI | **Partial** |
| Structured data | **Partial** |
| Metadata trang | **Partial** |
| Công cụ vận hành cho biên tập | **Partial** |
| First-party content / GEO foundation | **Gap** |

> `next/image`, `sizes`, preload ảnh LCP và không dùng webfont là tín hiệu implementation tốt,
> nhưng không đủ để chấm Core Web Vitals. CWV chỉ được coi là verified khi có measurement runtime
> phù hợp (lab và/hoặc field data theo scope release).

## Điểm mạnh

1. **Module SEO thuần.** Tám file `src/seo/` chủ yếu nhận `origin` + `indexingEnabled`, không đọc
   `process.env` rải rác hay phụ thuộc request tùy ý, nên test được ở tầng domain.
2. **Parsing indexation fail-closed và có blocked-host enforcement một phần.**
   `SEARCH_INDEXING_ENABLED` bắt buộc tường minh `"true"`/`"false"`; `release:check` chặn deploy
   khi thiếu/invalid và staging/localhost bị block cứng. Temporary production host
   `la.lanadesign.vn` **chưa** nằm trong `BLOCKED_INDEXING_HOSTS`, nên policy ADR 0004 chưa được
   enforce bằng cùng lớp code này.
3. **Canonical origin do máy chủ sở hữu.** `APP_DOMAIN` là nguồn chuẩn; không lấy canonical từ
   `Host` header do client kiểm soát.
4. **Vòng đời URL sản phẩm có contract.** `src/proxy.ts` + `ProductSlugHistory` hỗ trợ current
   slug / historical redirect / not-found rõ ràng.
5. **Chính sách phân trang chống duplicate.** Chỉ `?page=N` hợp lệ trên `/shop` và
   `/collections/<slug>` được index/self-canonical; biến thể query khác fail-closed.
6. **Sitemap lọc dữ liệu đầu vào.** Loại product inactive/không present/sai shop, collection draft
   và slug lịch sử. Repo cũng có ngưỡng URL tường minh, nhưng vượt ngưỡng hiện là hard failure
   (`RangeError`), không phải graceful safeguard; xem W21.
7. **Structured data fail-closed.** `buildOffer` không phát offer khi giá/trạng thái variant không
   đáng tin; `serializeJsonLd` escape `<`.
8. **Nền tảng performance hợp lý.** `next/image`, `remotePatterns` hẹp, `sizes`, preload ảnh hero
   và không có webfont làm giảm một số rủi ro phổ biến, nhưng chưa thay thế measurement.
9. **SEO có test ở nhiều tầng**, gồm domain/database và một số HTTP smoke qua Next server thật.
10. **Runbook indexation có rollback.** `docs/operations/p12-search-exposure.md` mô tả gate trước
    khi bật index và cách quay lại trạng thái fail-closed.

## Finding cần xử lý

### Gate — không phải defect

- **G1 — Temporary production domain có policy gate nhưng thiếu enforcement gate.** ADR 0004 yêu
  cầu `SEARCH_INDEXING_ENABLED=false` trên `la.lanadesign.vn` để tránh index/canonical confusion
  trước khi có domain thương hiệu vĩnh viễn. Đây là **policy đúng hiện tại**, nhưng source code chưa
  hard-block host này: `BLOCKED_INDEXING_HOSTS` chỉ bảo vệ staging/local, nên một cấu hình
  `SEARCH_INDEXING_ENABLED=true` trên `la.lanadesign.vn` có thể vượt `release:check`. `/plan` phải
  tách hai việc: (a) giữ policy noindex + human approval gate; (b) bổ sung enforcement để temporary
  production host không thể bật index do config sai. Không coi gate là hoàn tất cho tới khi policy
  và enforcement nhất quán.

### Required — nên hoàn tất trước index launch

- **W2 — Slug/path kỹ thuật nằm trong metadata PDP, nhưng đang giữ một uniqueness contract.**
  `src/seo/product-metadata.ts` nối slug vào title và nối `/shop/<slug>` vào description. Copy này
  kém tự nhiên cho SERP, nhưng P13 đang dùng canonical slug như discriminator để bảo đảm metadata
  khác nhau giữa products khi `seoTitle`/`seoDescription` không unique ở DB. Vì vậy **không được gỡ
  slug/path trước khi có cơ chế thay thế bảo toàn uniqueness contract**. `/plan` phải chọn và chứng
  minh một contract collision-safe (ví dụ validation chỉ block khi thực sự collision, hoặc một
  human-readable discriminator được chứng minh đủ để phân biệt collision group); màu/collection
  tự thân không được coi là unique nếu chưa có bằng chứng. Regression hiện có trong
  `tests/domain/product-metadata.test.ts` phải được cập nhật để tiếp tục chứng minh uniqueness sau
  khi thay contract.

  **Cập nhật W2a (U4):** replacement contract và bằng chứng collision nằm ở
  `docs/audits/seo-metadata-uniqueness-w2a.md`. Kết luận hiện tại: **BLOCKED** — không có
  discriminator human-readable nào chứng minh được unique từ schema hiện tại, nên W2b chưa được
  phép bỏ slug/path.

- **W3 — Sale price bị biến thành `PRICE_UNRESOLVED`.** `resolveStorefrontPrice` trả `null` khi
  `retailPrice !== retailPriceAfterDiscount`, khiến variant không purchasable, card có thể hiện
  "Giá đang cập nhật" và JSON-LD không có offer. Không được sửa bằng phỏng đoán. Trước hết chạy
  `pnpm pancake:catalog:audit` trên dữ liệu thật và xác nhận contract Pancake; chỉ sau đó mới quyết
  định khi nào `retailPriceAfterDiscount < retailPrice` là sale price hợp lệ.

- **W4 — Variant discoverability contract chưa đủ để triển khai `ProductGroup`.** `buildOffer`
  hiện yêu cầu mọi variant cùng một giá và bỏ `offers` nếu giá khác nhau. **Không dùng
  `AggregateOffer` để gộp một tập product variants.** Google Search hướng dẫn dùng `ProductGroup`
  (`variesBy`, `hasVariant`, `productGroupID`) và mỗi variant `Product` có `Offer` riêng. Tuy nhiên,
  repo hiện chỉ có PDP `/shop/[slug]`; lựa chọn kind/color/size nằm trong React local state, nên
  chưa có URL có thể mở trực tiếp một variant cụ thể.

  Với single-page variant model, Google yêu cầu:

  - mỗi variant có unique ID đáng tin (`sku`/GTIN hoặc identifier tương đương đã xác minh);
  - mỗi variant có **distinct URL** có thể preselect trực tiếp variant đó;
  - khi mở URL variant, UI phải phản ánh đúng image/price/availability và cho phép mua đúng variant;
  - toàn bộ variants của một `ProductGroup` single-page vẫn dùng **một canonical base PDP URL**.

  Vì vậy `/plan` không được nhảy thẳng sang JSON-LD. Dependency đúng là:
  **variant identity → variant URL/deep-link + preselection → query/canonical policy →
  `ProductGroup`/variant `Offer` markup → HTTP/Rich Results verification**.

  **Cập nhật W4d (U27):** dependency chain trên đã hoàn tất, nên markup đã được triển khai.
  PDP hiện phát `ProductGroup` + một `Product` variant với `Offer` **exact** cho từng variant
  publishable, thay thế (không đứng cạnh) `Product` product-level cũ, nên trang không còn hai
  product-schema authority mâu thuẫn. Các quyết định đã chốt:

  - variant URL tái sử dụng đúng contract U12 `/shop/<slug>?variant=<pancakeVariationId>`, được
    build bởi chính module sở hữu contract đó; canonical/indexing policy của W4c không đổi (base
    PDP vẫn là canonical duy nhất, variant query vẫn `noindex`);
  - eligibility không được định nghĩa lại: mỗi candidate được đưa ngược qua resolver U12 trên chính
    projection của trang, nên composite, external id trùng, `MAPPING_REQUIRED`/`AMBIGUOUS_OPTION`,
    id rỗng/quá dài đều fail closed vì cùng một lý do — URL sẽ không mở đúng variant nó đặt tên;
  - `price`/`availability` lấy từ projection PDP (rule promotion-aware dùng chung), không phải một
    đường giá thứ hai; giá chưa resolve thì không phát offer;
  - `productGroupID` là `pancakeProductId`; **không** phát `sku`/`mpn`/`gtin` — MPN authority thuộc
    ADR 0008 và U25/M3, U27 không mở identifier design mới;
  - `variesBy` chỉ liệt kê chiều mà các variant được phát thực sự khác nhau;
  - **không** `AggregateOffer`, `lowPrice`, `highPrice`, `offerCount` cho một tập variants;
  - composite giữ nguyên hành vi product-level an toàn hiện có (parent set only), không bị mô hình
    hoá thành một variant family.

- **W15 — 0/5 dedicated SEO HTTP smoke được wire trực tiếp, nhưng các contract không hoàn toàn
  ungated.** Các script `search-exposure-http-smoke.ts`, `structured-data-http-smoke.ts`,
  `product-metadata-http-smoke.ts`, `oai-robots-http-smoke.ts`, `product-slug-http-smoke.ts` đều
  tồn tại, nhưng **không script nào trong nhóm này** được workflow hiện tại hoặc npm script gọi
  trực tiếp. Tuy nhiên CI đã có overlapping coverage: `pnpm test` chạy domain/integration regressions
  cho search exposure, metadata, structured data, robots và slug; P18 production-runtime còn kiểm
  tra noindex, canonical absence khi indexing disabled, parent Product/Offer JSON-LD, `OAI-SearchBot`
  trong `robots.txt` và sitemap rỗng ở trạng thái noindex. Vì vậy gap thực sự là **chưa có mapping
  tường minh giữa signal riêng của năm dedicated smoke và coverage hiện có**, không phải cả năm
  contract đều không được CI bảo vệ. P2 phải inventory từng smoke, xác định case HTTP/runtime nào
  còn chưa được gate, rồi wire các case còn gap; chỉ gom thành một SEO runtime command chuẩn nếu
  việc đó giảm duplication và làm ownership/verification rõ hơn.

  **Cập nhật W15a (U5):** inventory đã hoàn tất trong `docs/audits/seo-runtime-coverage-w15a.md`.
  Nó đính chính tiền đề "0/5 được wire": không script nào được gọi trực tiếp bởi workflow/npm
  script, nhưng cả năm đều được `tests/integrations/product-slug-http.test.ts` import nên chạy
  qua `pnpm test` trong mọi PR. Gap thật sự còn lại được liệt kê theo signal trong coverage map.

- **W13A — Evergreen content thiếu owner-approved source facts/policies.** Site chưa có các page
  chuẩn về About, Returns, Shipping/Payment, Size Guide, Contact; nhưng `buildPublicBrandFacts`
  hiện mới có brand summary, COD, account-less checkout, shipping promotion, order tracking và
  server verification. Nó **không** cung cấp return policy, contact/address facts hay một site-wide
  size policy đầy đủ. Coding agent không được tự bịa các business facts này. Trước page build phải
  có human-approved factual source/content contract cho từng nhóm policy cần public.

  **Cập nhật W13A (U6):** inventory đầy đủ nằm ở `docs/audits/first-party-content-facts-w13a.md`.
  Kết luận: chỉ Shipping/Payment có phần A-class dùng được; Returns, Size Guide và Contact
  **BLOCKED — OWNER FACT/APPROVAL REQUIRED** toàn bộ. W6/U32 Organization enrichment bị chặn bởi
  cùng quyết định owner đó.

### Medium — leverage cao sau correctness

- **W5 — Product/variant schema còn mỏng.** *(Phần variant-level đã do U27 giao: `color`/`size`
  và `Offer` per-variant đã có. Phần còn lại — identifier product-level đã xác minh, `itemCondition`,
  shipping/return policy — vẫn thuộc U32 và vẫn chưa được phát.)* Repo đã có dữ liệu như `sku`, `color`, `size`,
  `pancakeDisplayId`, `pancakeBarcode`, nhưng JSON-LD chưa khai thác. Bổ sung trường chỉ khi source
  semantics được xác minh. Đặc biệt **không suy `pancakeBarcode == gtin13` chỉ từ tên field**;
  phải xác nhận loại identifier, format/check digit và contract upstream. Có thể xem xét
  `itemCondition`, shipping/return policy và variant-level Offer theo tài liệu merchant listing.

- **W6 — Organization entity còn mỏng.** Hiện chỉ có `name` + `url`. Có thể bổ sung `logo`,
  `sameAs`, `contactPoint`, `address` khi dữ liệu first-party đã được xác minh và thực sự public.
  Mục tiêu là entity consistency, không phải nhồi schema để "tối ưu LLM".

- **W8 — Root metadata thiếu Open Graph/Twitter mặc định.** PDP có social metadata riêng nhưng
  homepage/collection/lookbook không có default social card. Social card hiện có thể dùng làm
  fallback. Đây là social-sharing presentation issue; **không gắn rationale với Meta Pixel/CAPI**
  vì tracking và OG/Twitter là hai contract độc lập.

- **W9 — Sitemap chưa có `lastModified`, nhưng raw `updatedAt` chưa đủ semantic.** Google chỉ dùng
  `lastmod` khi timestamp nhất quán, kiểm chứng được và phản ánh **significant page update**. Không
  copy mù `ProductMirror.updatedAt`, vì mirror sync/inventory/internal updates có thể đổi timestamp
  mà public page không thay đổi đáng kể. `/plan` cần xác định nguồn `publicContentModifiedAt` hoặc
  equivalent từ các thay đổi thật sự ảnh hưởng nội dung/structured data/link của page; nếu chưa
  chứng minh được timestamp chính xác thì để thiếu `lastModified` còn tốt hơn phát tín hiệu sai.

- **W10 — `/`, `/collections`, `/lookbook` chưa có self-canonical rõ ràng.** Đây là pre-index
  hygiene tốt để làm, nhưng không phải lỗi nghiêm trọng tương đương duplicate pagination. Ưu tiên
  sau W2/W3/W15 và giữ canonical từ trusted origin.

- **W13 — Thiếu authoritative evergreen first-party content.** Site đã có homepage editorial,
  lookbook, collection copy và brand facts, vì vậy câu "không có content cho AI trích dẫn" là quá
  tuyệt đối. Gap thực sự là thiếu các trang nguồn chuẩn có thể link/crawl cho: giới thiệu thương
  hiệu, đổi trả, vận chuyển/thanh toán, hướng dẫn size và liên hệ. Sau khi W13A có source facts
  được owner phê duyệt, triển khai page từ nguồn đó và ưu tiên nội dung hữu ích/nguyên bản; không
  tạo page chỉ để nhắm "GEO keywords".

- **W14 — Crawl-recovery 404 hiện có hai đường và branded `not-found.tsx` một mình không đủ.**
  App chưa có branded `not-found.tsx`, nhưng quan trọng hơn, unknown product slug bị
  `src/proxy.ts` trả trực tiếp `404 text/plain` trước khi Next routing có cơ hội render not-found UI.
  Vì vậy `/plan` phải xử lý cả hai: branded 404 cho route-level not-found **và** unknown product-slug
  path phải trả một HTML 404 có navigation/recovery phù hợp, đồng thời giữ nguyên contract current
  slug / historical 301 / unknown 404. Không prescribe cách chuyển ownership giữa proxy và Next
  trước khi review regression của slug lifecycle.

### Low / operational / optional

- **W12 — Listing `ItemList`/`CollectionPage` không nằm trên critical path.** `/shop` chưa phát
  listing structured data, nhưng Google Merchant Listing khuyến nghị tập trung `Product` markup ở
  single-product/variant pages thay vì category/listing pages. Google có beta carousel dùng
  `ItemList` + `Product` trên summary pages, nhưng feature hiện chỉ khả dụng ở EEA, Turkey và South
  Africa; không có target-market requirement nào trong audit chứng minh giá trị trực tiếp cho
  storefront Việt Nam. Chỉ đưa W12 vào `/plan` nếu có consumer/market requirement cụ thể hoặc
  search evidence mới; nếu làm thì markup phải khớp visible catalog và canonical URLs.

- **W16 — Admin SEO thiếu guidance.** Có thể thêm character counter, duplicate warning và SERP
  preview. Ngưỡng khoảng `60/155` chỉ nên là **soft editorial guidance**, không phải hard SEO
  validation: Google không đặt giới hạn cố định cho title/meta description và truncate theo context
  / device. Không chặn publish ở ký tự 61/156.

- **W17 — Admin chưa có filter `missing-seo` / `missing-editorial`.** Hữu ích cho vận hành khi số
  product tăng; không phải launch blocker nếu editorial inventory còn nhỏ.

- **W18 — Chưa có bằng chứng Search Console/Bing Webmaster verification.** Chuẩn bị verification
  cho domain vĩnh viễn và Merchant Center trước index launch. Việc thiếu `manifest`/`apple-icon`
  không nên gộp thành SEO blocker; xử lý như web-app/brand polish riêng nếu cần.

- **W19 — Crawler governance chưa tách theo mục đích.** Không gom `OAI-SearchBot`, search crawlers,
  training/model crawlers và Google-specific controls thành một nhóm "AI bots". `/plan` nên có
  matrix theo mục đích: search discovery, user-triggered retrieval, model training và controls đặc
  thù từng vendor. Policy cuối cùng cần owner approval vì đây là quyết định distribution/data use,
  không chỉ là code change.

- **W20 — `llms.txt` không phải Google SEO/GEO requirement.** Google Search hiện nói không cần
  machine-readable AI text files/markup đặc biệt để xuất hiện trong AI Overviews/AI Mode và Google
  Search không dùng `llms.txt` như tín hiệu đặc biệt. Chỉ thêm `llms.txt` nếu xác định consumer cụ
  thể ngoài Google có giá trị đủ lớn để đáng duy trì. Không đưa vào critical path.

- **W21 — Sitemap có hard size cliff, chưa có scale-out path.** Repo hiện dùng một sitemap và
  `search-sitemap-repository` ném `RangeError` khi dynamic URL count vượt ngưỡng 49.996;
  `src/app/sitemap.ts` không có graceful fallback, nên endpoint có thể thành HTTP 500 thay vì phát
  sitemap partial/index. Với quy mô hiện tại đây chưa phải launch blocker, nhưng `/plan` phải ghi
  rõ trigger/owner trước khi tiến gần ngưỡng và khi đó triển khai sitemap index/phân mảnh thay vì
  để hard failure xảy ra. Image sitemap vẫn là enhancement riêng nếu product images đã crawlable.

## Lịch sử ID finding

Để giữ traceability với bản audit trước, ID không được renumber liên tục. Các khoảng trống là chủ
đích, không phải finding bị rơi:

- **W1 → G1:** trạng thái noindex trên temporary production domain được tách thành policy gate +
  enforcement gap thay vì coi là SEO defect thông thường.
- **W7:** `SearchAction` bị loại khỏi roadmap vì sitelinks search box đã retired.
- **W11:** claim cũ gom `/search` và `/new-arrivals` thành "stub rỗng" bị loại; hai route được xử lý
  riêng trong section `/search` và `/new-arrivals` bên dưới.

## Finding đã loại khỏi roadmap

Các mục dưới đây **không được đưa vào `/plan` như SEO work** trừ khi requirement mới xuất hiện:

1. **`SearchAction` / sitelinks search box.** Google đã ngừng sitelinks search box từ
   2024-11-21; unsupported markup không mang lại Search feature này nữa. `/search` vẫn có thể tồn
   tại cho UX và submit sang `/shop?q=` mà không cần `SearchAction`.
2. **`FAQPage` chỉ để lấy Google rich result.** Google đã ngừng hiển thị FAQ rich result và xóa
   documentation feature này trong 2026. FAQ nội dung thật vẫn có thể hữu ích cho người dùng, nhưng
   không tạo JSON-LD FAQ chỉ vì SEO.
3. **`AggregateOffer` để đại diện product variants.** Google nói rõ không dùng `AggregateOffer`
   cho một tập variants; dùng `ProductGroup`/`Product` + variant `Offer` sau khi variant URL/identity
   contract đã đủ điều kiện.
4. **Hard title/description limit 60/155.** Chỉ là UI guidance, không phải correctness contract.
5. **`llms.txt` như launch blocker hoặc Google GEO tactic.** Không có căn cứ từ Google Search.
6. **Listing `ItemList` như mặc định cho storefront Việt Nam.** Không đưa vào critical path khi
   chưa có target-market/consumer requirement; beta carousel hiện không phải feature toàn cầu.

## `/search` và `/new-arrivals`

Không nên gộp hai route này thành "stub rỗng":

- `/search` có form search hoạt động và redirect query sang `/shop?q=...`. Một internal search page
  có thể hữu ích cho người dùng đồng thời vẫn `noindex`; việc `noindex` không tự động có nghĩa phải
  bỏ link khỏi navigation.
- `/new-arrivals` cần review riêng về nội dung và product semantics. Chỉ index nếu nó trở thành
  landing page có dữ liệu thật, ổn định và có canonical rõ ràng. Nếu vẫn là placeholder, bỏ hoặc
  giữ noindex tùy UX contract.

## Planning handoff

`/plan` nên dùng thứ tự ưu tiên dưới đây thay vì triển khai từng W-number theo danh sách tuyến tính.
Mỗi task/PR vẫn phải tuân ADR 0005: một concern reviewable, có acceptance criteria và verification.

### P0 — Giữ policy gate và đóng enforcement gap

- Giữ `SEARCH_INDEXING_ENABLED=false` trên `la.lanadesign.vn`.
- Thêm hard-block/enforcement tương đương cho temporary production host để `release:check` không thể
  pass khi host này bị cấu hình `SEARCH_INDEXING_ENABLED=true`.
- Xác định domain vĩnh viễn + owner approval là dependency bên ngoài trước index launch; migration
  khỏi temporary-host block phải là thay đổi tường minh/reviewable khi domain vĩnh viễn sẵn sàng.
- Không thay đổi canonical/indexing policy chỉ để test SEO traffic trên temporary domain.

### P1 — Correctness thương mại, metadata và variant addressability

1. W2a: xác định cơ chế uniqueness thay thế và test collision cases trước khi bỏ slug/path.
2. W2b: chỉ khi W2a chứng minh contract mới collision-safe mới bỏ slug/path khỏi PDP metadata và
   cập nhật regression tests.
3. W3: audit dữ liệu Pancake và định nghĩa sale-price contract trước khi sửa resolver.
4. W4a: xác minh identifier nào có thể làm stable variant identity; không suy GTIN từ barcode name.
5. W4b: thiết kế distinct variant URL/deep-link + server/client preselection cho kind/color/size.
6. W4c: định nghĩa query/index/canonical contract: variant URLs preselect được nhưng single-page
   product group dùng canonical base PDP.
7. W4d: chỉ sau W4a–W4c mới thiết kế `ProductGroup`/`Product` + variant `Offer` JSON-LD.

**Gate:** URL variant phải mở trực tiếp đúng lựa chọn và phản ánh đúng image/price/availability/
purchasability trước khi structured data dùng URL đó. Không phát price/identifier/schema mà source
semantics chưa được chứng minh.

### P2 — Regression safety trước index

8. W15a: inventory năm dedicated SEO HTTP smoke so với `pnpm test`, P18 production-runtime và
   các runtime workflow hiện có; ghi rõ signal nào đã overlap và signal HTTP/runtime nào còn thiếu.
9. W15b: wire các case còn gap vào CI; chỉ tạo một command SEO runtime chung khi nó thực sự gom được
   signal cần thiết mà không chạy lặp vô ích. Verify noindex/indexable states, base/variant canonical
   behavior, redirect, metadata, robots và structured data qua Next server thật theo coverage map.

### P3 — Search/social fundamentals

10. W8: root OG/Twitter fallback.
11. W10: self-canonical cho static indexable pages khi indexing enabled.
12. W9: chỉ thêm sitemap `lastModified` sau khi có timestamp phản ánh significant public change.
13. W14a: branded route-level 404 + đường quay lại shop/search.
14. W14b: sửa unknown product-slug path để trả HTML 404 recovery thay vì proxy `text/plain`, nhưng
    giữ nguyên current slug / historical 301 / unknown 404 contract.

### P4 — Commerce discovery trên PDP

15. W5: bổ sung verified identifiers + variant attributes + shipping/return semantics.
16. W6: enrich Organization từ first-party facts đã xác minh.
17. Chuẩn bị/kiểm tra Google Merchant Center feed + PDP structured-data consistency; feed và schema
    phải cùng mô tả một catalog/price/availability contract.
18. W12 không nằm trong P4 mặc định; chỉ promote từ optional khi có market/consumer requirement.

### P5 — First-party content với human content gate

19. W13A: lập inventory những fact/policy cần cho About, Returns, Shipping/Payment, Size Guide,
    Contact và đánh dấu phần đã có source vs phần chưa có.
20. Human owner phê duyệt factual content/policy còn thiếu trước khi coding agent tạo public page.
21. W13: build evergreen pages từ approved facts; reuse một nguồn fact/contract chuẩn thay vì copy
    nội dung giữa footer, pages và schema.
22. Thêm internal links theo user journey và crawlability; không tạo thin pages hàng loạt cho GEO.

**Gate:** nếu return/contact/size policy chưa được owner cung cấp hoặc phê duyệt thì planner phải
đánh dấu blocked; không tự suy diễn business policy từ code, UI copy hay naming convention.

### P6 — Operational readiness

23. W16/W17: admin readiness, preview/counter/warnings/health filters.
24. W18: Search Console + Bing Webmaster + Merchant Center verification trên permanent domain.
25. W19: owner-approved crawler governance matrix.
26. W21: theo dõi catalog URL volume và đặt trigger trước ngưỡng hard failure; triển khai sitemap
    index/phân mảnh khi evidence cho thấy sắp chạm ngưỡng, không đợi endpoint bắt đầu 500.
27. W12 chỉ triển khai nếu target market/consumer evidence mới chứng minh listing markup có giá trị.

### P7 — Performance verification

28. Đo performance runtime trên representative pages (`/`, `/shop`, collection, PDP) ở mobile và
    desktop; ghi baseline LCP/CLS/INP/lab diagnostics theo tooling được chọn.
29. Chỉ tạo blocking budget khi đã có baseline + threshold hợp lý; không biến score đọc từ source
    thành CWV evidence.

## Definition of Done cho roadmap sau `/plan`

Một implementation phase chỉ được coi hoàn tất khi ngoài acceptance criteria của phase còn có:

- focused tests cho behavior mới và regression tests cho bug/contract thay đổi;
- relevant full suite + typecheck/lint/build xanh;
- HTTP/runtime verification cho metadata/indexing/structured-data paths;
- variant deep-link URL mở trực tiếp đúng variant trước khi URL đó xuất hiện trong Product markup;
- structured data được validate với contract Google hiện hành và khớp visible page data;
- business policy/content public có owner-approved source, không phải agent-authored assumption;
- không mở index trên temporary domain;
- không phát identifier/price/lastmod không đáng tin;
- docs/runbook phản ánh current truth;
- risky index/domain rollout có rollback path và human approval.

## Nguồn chính thức đã dùng để hiệu chỉnh audit

- Google — Product variants (`ProductGroup`, `Product`), distinct variant URLs + single-page
  canonical requirement:
  https://developers.google.com/search/docs/appearance/structured-data/product-variants
- Google — Merchant listing: ưu tiên Product markup ở single-product/variant pages thay vì category
  pages:
  https://developers.google.com/search/docs/appearance/structured-data/merchant-listing
- Google — Structured data carousels beta: `ItemList` + `Product`, hiện giới hạn EEA/Turkey/South
  Africa:
  https://developers.google.com/search/docs/appearance/structured-data/carousels-beta
- Google — Product snippet / `AggregateOffer` (không dùng cho tập product variants):
  https://developers.google.com/search/docs/appearance/structured-data/product-snippet
- Google — Sitelinks search box retired từ 2024-11-21:
  https://developers.google.com/search/blog/2024/10/sitelinks-search-box
- Google — Title links (không có hard character limit):
  https://developers.google.com/search/docs/appearance/title-link
- Google — Snippets/meta descriptions (không có hard character limit):
  https://developers.google.com/search/docs/appearance/snippet
- Google — Sitemap `lastmod` phải phản ánh significant update và chính xác nhất quán:
  https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- Google — AI features: không cần special AI files/markup:
  https://developers.google.com/search/docs/appearance/ai-features
- Google — Generative AI optimization guide; `llms.txt` không được Google Search dùng như special
  signal:
  https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- Google — Search documentation updates; FAQ rich result documentation bị loại bỏ trong 2026:
  https://developers.google.com/search/updates

## Ước lượng phạm vi cho `/plan`

Không dùng số PR cũ như commitment. Planner nên break theo dependency và reviewability sau khi đọc
source/tests tương ứng. Ballpark hiện tại:

| Workstream | Ballpark PR | Rủi ro chính |
| --- | ---: | --- |
| P1 correctness + variant addressability | 4–7 | Sale-price contract + deep-link/canonical + ProductGroup |
| P2 regression safety | 1–2 | CI runtime duration / deterministic fixtures |
| P3 search fundamentals | 2–4 | Accurate `lastModified` semantics |
| P4 commerce discovery | 2–4 | Identifier trust + schema/feed consistency |
| P5 first-party content | 3–5 | Human policy/content approval trước implementation |
| P6 operations | 2–4 | External verification + crawler policy decision |
| P7 performance verification | 1–2 | Representative baseline và stable measurement |

**Planning constraint cuối:** ưu tiên correctness → verifiability → discoverability → enhancement.
Không triển khai GEO/structured-data tactic chỉ vì nó phổ biến nếu không có consumer hoặc tài liệu
chính thức hiện hành chứng minh giá trị.
