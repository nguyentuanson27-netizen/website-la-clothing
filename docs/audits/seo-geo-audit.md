# Kiểm toán SEO/GEO

Thực hiện tại commit `31f88b3`. Phạm vi đọc: `src/seo/`, `src/app/`, `src/proxy.ts`,
`src/commerce/storefront-product.ts`, `src/content/`, `src/components/`, `prisma/schema.prisma`,
`scripts/`, `.github/workflows/`, `docs/`. Không có thay đổi mã nguồn nào kèm theo tài liệu này.
Các nhận định về hành vi runtime được suy ra từ mã nguồn và test; Core Web Vitals và hành vi
production chưa được đo trực tiếp.

Các khuyến nghị phụ thuộc Google Search/structured data được đối chiếu lại với tài liệu chính thức
ngày 2026-08-30. Tài liệu này là **audit + planning input**, không phải implementation plan.

## Kết luận

Nền tảng kỹ thuật SEO của repo tốt: indexation fail-closed, canonical lấy từ origin tin cậy,
301 cho slug lịch sử, policy phân trang chống duplicate, sitemap lọc URL không hợp lệ và nhiều
contract SEO đã có test. Điểm yếu lớn nhất trước khi mở index không nằm ở một "GEO hack", mà ở
ba lớp cơ bản:

1. **Correctness thương mại:** sale price hiện bị coi là unresolved và structured data chưa mô hình
   đúng product variants có giá khác nhau.
2. **Search presentation + regression safety:** metadata PDP còn nhét slug/path kỹ thuật và một số
   HTTP smoke SEO chưa nằm trong CI.
3. **First-party content + commerce discovery:** thiếu các trang evergreen có thẩm quyền về brand,
   đổi trả, vận chuyển, size và liên hệ; structured data thương mại còn mỏng.

`SEARCH_INDEXING_ENABLED=false` trên domain tạm là **release gate có chủ đích theo ADR 0004, không
phải bug cần "fix"**. Không bật index cho `la.lanadesign.vn`; chỉ mở index sau khi domain vĩnh viễn
được xác nhận và có phê duyệt human riêng.

| Hạng mục | Đánh giá |
| --- | --- |
| Kiến trúc & mã nguồn SEO | 9/10 |
| Kiểm soát index & crawl (thiết kế) | 9/10 |
| Performance implementation readiness | 8/10 |
| Core Web Vitals thực tế | **UNVERIFIED** |
| Kiểm thử & CI | 7/10 |
| Structured data | 6/10 |
| Metadata trang | 5/10 |
| Công cụ vận hành cho biên tập | 5/10 |
| First-party content / GEO foundation | 4/10 |

> `next/image`, `sizes`, preload ảnh LCP và không dùng webfont là tín hiệu implementation tốt,
> nhưng không đủ để chấm Core Web Vitals. CWV chỉ được coi là verified khi có measurement runtime
> phù hợp (lab và/hoặc field data theo scope release).

## Điểm mạnh

1. **Module SEO thuần.** Tám file `src/seo/` chủ yếu nhận `origin` + `indexingEnabled`, không đọc
   `process.env` rải rác hay phụ thuộc request tùy ý, nên test được ở tầng domain.
2. **Cổng index fail-closed.** `SEARCH_INDEXING_ENABLED` bắt buộc tường minh `"true"`/`"false"`;
   `release:check` chặn deploy khi thiếu; staging/localhost vẫn bị block cứng.
3. **Canonical origin do máy chủ sở hữu.** `APP_DOMAIN` là nguồn chuẩn; không lấy canonical từ
   `Host` header do client kiểm soát.
4. **Vòng đời URL sản phẩm có contract.** `src/proxy.ts` + `ProductSlugHistory` hỗ trợ current
   slug / historical redirect / not-found rõ ràng.
5. **Chính sách phân trang chống duplicate.** Chỉ `?page=N` hợp lệ trên `/shop` và
   `/collections/<slug>` được index/self-canonical; biến thể query khác fail-closed.
6. **Sitemap lọc dữ liệu.** Loại product inactive/không present/sai shop, collection draft và slug
   lịch sử; có trần URL trước khi vượt giới hạn file sitemap.
7. **Structured data fail-closed.** `buildOffer` không phát offer khi giá/trạng thái variant không
   đáng tin; `serializeJsonLd` escape `<`.
8. **Nền tảng performance hợp lý.** `next/image`, `remotePatterns` hẹp, `sizes`, preload ảnh hero
   và không có webfont làm giảm một số rủi ro phổ biến, nhưng chưa thay thế measurement.
9. **SEO có test ở nhiều tầng**, gồm domain/database và một số HTTP smoke qua Next server thật.
10. **Runbook indexation có rollback.** `docs/operations/p12-search-exposure.md` mô tả gate trước
    khi bật index và cách quay lại trạng thái fail-closed.

## Finding cần xử lý

### Gate — không phải defect

- **G1 — Indexing đang tắt trên temporary production domain.** ADR 0004 yêu cầu
  `SEARCH_INDEXING_ENABLED=false` trên `la.lanadesign.vn` để tránh index/canonical confusion trước
  khi có domain thương hiệu vĩnh viễn. Đây là trạng thái đúng hiện tại. `/plan` phải giữ gate này:
  mọi công việc SEO có thể chuẩn bị trước, nhưng **không bật index** nếu chưa có domain vĩnh viễn +
  explicit human approval.

### Required — nên hoàn tất trước index launch

- **W2 — Slug/path kỹ thuật nằm trong metadata PDP.** `src/seo/product-metadata.ts` nối slug vào
  title và nối `/shop/<slug>` vào description. Nội dung này làm SERP copy kém tự nhiên và tạo
  boilerplate không cần thiết. Bỏ slug/path khỏi copy hiển thị; ưu tiên title/description mô tả
  sản phẩm bằng dữ liệu người mua hiểu được. Nếu cần phát hiện duplicate metadata, làm warning ở
  editorial/admin trước; **không mặc định thêm hard publish blocker chỉ để đạt uniqueness**.

- **W3 — Sale price bị biến thành `PRICE_UNRESOLVED`.** `resolveStorefrontPrice` trả `null` khi
  `retailPrice !== retailPriceAfterDiscount`, khiến variant không purchasable, card có thể hiện
  "Giá đang cập nhật" và JSON-LD không có offer. Không được sửa bằng phỏng đoán. Trước hết chạy
  `pnpm pancake:catalog:audit` trên dữ liệu thật và xác nhận contract Pancake; chỉ sau đó mới quyết
  định khi nào `retailPriceAfterDiscount < retailPrice` là sale price hợp lệ.

- **W4 — Structured data chưa mô hình product variants có giá khác nhau.** `buildOffer` hiện yêu
  cầu mọi variant cùng một giá và bỏ `offers` nếu giá khác nhau. **Không dùng `AggregateOffer` để
  gộp một tập product variants.** Google Search hiện hướng dẫn dùng `ProductGroup` để nhóm variants
  (`variesBy`, `hasVariant`, `productGroupID`) và mỗi `Product` variant có `Offer` tương ứng. Đây là
  thay đổi contract structured data, cần test bằng Rich Results-compatible JSON-LD và dữ liệu thật.

- **W15 — Một số HTTP smoke SEO chưa chạy trong CI.** Các script
  `search-exposure-http-smoke.ts`, `structured-data-http-smoke.ts`,
  `product-metadata-http-smoke.ts`, `oai-robots-http-smoke.ts`,
  `product-slug-http-smoke.ts` tồn tại nhưng không phải toàn bộ đều được gọi bởi workflow hiện tại
  và không có một script npm chuẩn để chạy nhóm contract này. Các regression về indexation,
  metadata, robots và structured data có thể lọt qua CI. Nên gom thành command rõ ràng và nối vào
  workflow SEO runtime hiện có.

### Medium — leverage cao sau correctness

- **W5 — Product/variant schema còn mỏng.** Repo đã có dữ liệu như `sku`, `color`, `size`,
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

- **W12 — Listing pages chưa có structured data ở mức collection/item list.** `/shop` chưa phát
  `ItemList`/`CollectionPage`. Chỉ triển khai nếu markup phản ánh đúng visible products và URL
  canonical; không để structured data trở thành bản catalog khác với UI.

- **W13 — Thiếu authoritative evergreen first-party content.** Site đã có homepage editorial,
  lookbook, collection copy và brand facts, vì vậy câu "không có content cho AI trích dẫn" là quá
  tuyệt đối. Gap thực sự là thiếu các trang nguồn chuẩn có thể link/crawl cho: giới thiệu thương
  hiệu, đổi trả, vận chuyển/thanh toán, hướng dẫn size và liên hệ. Đây là nền cho SEO, AI Search,
  trust và customer support cùng lúc. Ưu tiên nội dung hữu ích/nguyên bản; không tạo page chỉ để
  nhắm "GEO keywords".

- **W14 — Không có branded `not-found.tsx`.** 404 mặc định thiếu điều hướng theo brand/storefront.
  Đây chủ yếu là UX/crawl recovery hygiene, không phải direct ranking feature.

### Low / operational / optional

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

- **W21 — Sitemap hiện là một file.** Sitemap index chỉ cần khi URL volume thực sự tiến gần giới
  hạn hoặc có lý do vận hành rõ ràng. Image sitemap cũng là enhancement, không phải prerequisite
  nếu product images đã crawlable từ pages. Giữ scope theo dữ liệu thực tế thay vì build trước cho
  scale giả định.

## Finding đã loại khỏi roadmap

Các mục dưới đây **không được đưa vào `/plan` như SEO work** trừ khi requirement mới xuất hiện:

1. **`SearchAction` / sitelinks search box.** Google đã ngừng sitelinks search box từ
   2024-11-21; unsupported markup không mang lại Search feature này nữa. `/search` vẫn có thể tồn
   tại cho UX và submit sang `/shop?q=` mà không cần `SearchAction`.
2. **`FAQPage` chỉ để lấy Google rich result.** Google đã ngừng hiển thị FAQ rich result và xóa
   documentation feature này trong 2026. FAQ nội dung thật vẫn có thể hữu ích cho người dùng, nhưng
   không tạo JSON-LD FAQ chỉ vì SEO.
3. **`AggregateOffer` để đại diện product variants.** Google nói rõ không dùng `AggregateOffer`
   cho một tập variants; dùng `ProductGroup`/`Product` + variant `Offer`.
4. **Hard title/description limit 60/155.** Chỉ là UI guidance, không phải correctness contract.
5. **`llms.txt` như launch blocker hoặc Google GEO tactic.** Không có căn cứ từ Google Search.

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

### P0 — Giữ index gate

- Giữ `SEARCH_INDEXING_ENABLED=false` trên `la.lanadesign.vn`.
- Xác định domain vĩnh viễn + owner approval là dependency bên ngoài trước index launch.
- Không thay đổi canonical/indexing policy chỉ để test SEO traffic trên temporary domain.

### P1 — Correctness thương mại và metadata

1. W2: bỏ slug/path kỹ thuật khỏi PDP metadata + regression tests.
2. W3: audit dữ liệu Pancake và định nghĩa sale-price contract trước khi sửa resolver.
3. W4: thiết kế variant structured-data contract theo `ProductGroup`/`Product` + `Offer`.

**Gate:** không phát price/identifier/schema mà source semantics chưa được chứng minh.

### P2 — Regression safety trước index

4. W15: tạo một command SEO HTTP smoke chuẩn và gọi nó trong CI.
5. Verify noindex/indexable states, canonical, redirect, metadata, robots và structured data qua
   Next server thật.

### P3 — Search/social fundamentals

6. W8: root OG/Twitter fallback.
7. W10: self-canonical cho static indexable pages khi indexing enabled.
8. W9: chỉ thêm sitemap `lastModified` sau khi có timestamp phản ánh significant public change.
9. W14: branded 404 + đường quay lại shop/search.

### P4 — Commerce discovery

10. W5: bổ sung verified identifiers + variant attributes + shipping/return semantics.
11. W6: enrich Organization từ first-party facts đã xác minh.
12. W12: listing structured data nếu có contract rõ và tests đảm bảo khớp visible catalog.
13. Chuẩn bị/kiểm tra Google Merchant Center feed + structured data consistency; feed và schema phải
    cùng mô tả một catalog/price/availability contract.

### P5 — First-party content

14. W13: xây các page evergreen tối thiểu: About, Returns, Shipping/Payment, Size Guide, Contact.
15. Reuse một nguồn fact/contract chuẩn thay vì copy nội dung giữa footer, pages và schema.
16. Thêm internal links theo user journey và crawlability; không tạo thin pages hàng loạt cho GEO.

### P6 — Operational readiness

17. W16/W17: admin readiness, preview/counter/warnings/health filters.
18. W18: Search Console + Bing Webmaster + Merchant Center verification trên permanent domain.
19. W19: owner-approved crawler governance matrix.
20. W21 chỉ triển khai khi URL/image scale hoặc operational evidence thực sự yêu cầu.

### P7 — Performance verification

21. Đo performance runtime trên representative pages (`/`, `/shop`, collection, PDP) ở mobile và
    desktop; ghi baseline LCP/CLS/INP/lab diagnostics theo tooling được chọn.
22. Chỉ tạo blocking budget khi đã có baseline + threshold hợp lý; không biến score đọc từ source
    thành CWV evidence.

## Definition of Done cho roadmap sau `/plan`

Một implementation phase chỉ được coi hoàn tất khi ngoài acceptance criteria của phase còn có:

- focused tests cho behavior mới và regression tests cho bug/contract thay đổi;
- relevant full suite + typecheck/lint/build xanh;
- HTTP/runtime verification cho metadata/indexing/structured-data paths;
- structured data được validate với contract Google hiện hành và khớp visible page data;
- không mở index trên temporary domain;
- không phát identifier/price/lastmod không đáng tin;
- docs/runbook phản ánh current truth;
- risky index/domain rollout có rollback path và human approval.

## Nguồn chính thức đã dùng để hiệu chỉnh audit

- Google — Product variants (`ProductGroup`, `Product`):
  https://developers.google.com/search/docs/appearance/structured-data/product-variants
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
| P1 correctness | 3–5 | Sale-price contract + variant structured data |
| P2 regression safety | 1–2 | CI runtime duration / deterministic fixtures |
| P3 search fundamentals | 2–4 | Accurate `lastModified` semantics |
| P4 commerce discovery | 3–5 | Identifier trust + schema/feed consistency |
| P5 first-party content | 3–5 | Nội dung/approval, không phải kỹ thuật |
| P6 operations | 2–4 | External verification + crawler policy decision |
| P7 performance verification | 1–2 | Representative baseline và stable measurement |

**Planning constraint cuối:** ưu tiên correctness → verifiability → discoverability → enhancement.
Không triển khai GEO/structured-data tactic chỉ vì nó phổ biến nếu không có consumer hoặc tài liệu
chính thức hiện hành chứng minh giá trị.
