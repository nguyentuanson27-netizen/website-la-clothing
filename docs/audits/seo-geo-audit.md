# Kiểm toán SEO/GEO

Thực hiện tại commit `31f88b3`. Phạm vi đọc: `src/seo/`, `src/app/`, `src/proxy.ts`,
`src/commerce/storefront-product.ts`, `src/content/`, `src/components/`, `prisma/schema.prisma`,
`scripts/`, `.github/workflows/`, `docs/`. Không có thay đổi mã nguồn nào kèm theo tài liệu này.
Các nhận định về hành vi runtime được suy ra từ mã nguồn và test, chưa kiểm chứng trên production.

## Kết luận

Hạ tầng kỹ thuật SEO ở mức tốt: chính sách index fail-closed, canonical do máy chủ sở hữu,
301 cho slug lịch sử, quy tắc phân trang chống trùng lặp, sitemap chỉ chứa URL thật — tất cả
đều có kiểm thử ở tầng domain, tầng cơ sở dữ liệu và HTTP smoke qua Next server thật.

Phần thu hút traffic thì chưa bắt đầu: toàn site đang `noindex` theo cổng phê duyệt ADR 0004,
tiêu đề sản phẩm nhồi slug kỹ thuật, sản phẩm giảm giá mất toàn bộ dữ liệu giá, và không có
trang nội dung nào để công cụ tìm kiếm sinh tạo trích dẫn.

| Hạng mục | Điểm |
| --- | --- |
| Kiến trúc & mã nguồn SEO | 9/10 |
| Kiểm soát index & crawl (thiết kế) | 9/10 |
| Hiệu năng & Core Web Vitals | 8/10 |
| Kiểm thử & CI | 7/10 |
| Structured data | 6/10 |
| Metadata trang | 5/10 |
| Công cụ vận hành cho biên tập | 5/10 |
| Nội dung & GEO | 3/10 |

## Điểm mạnh

1. **Module SEO thuần.** Tám file `src/seo/` là hàm thuần nhận `origin` + `indexingEnabled`,
   không đọc `process.env` rải rác, không đọc request — test được ở tầng domain.
2. **Cổng index fail-closed.** `SEARCH_INDEXING_ENABLED` bắt buộc tường minh `"true"`/`"false"`;
   `release:check` chặn deploy khi thiếu; `BLOCKED_INDEXING_HOSTS` chặn cứng staging và localhost.
3. **Canonical do máy chủ sở hữu.** `APP_DOMAIN` là nguồn duy nhất; header `Host` không bao giờ
   được dùng — phòng thủ đúng trước host-header poisoning.
4. **Vòng đời URL sản phẩm đúng chuẩn.** `src/proxy.ts` + `ProductSlugHistory`: 200 / 301 chính
   xác / 404.
5. **Chính sách phân trang chống trùng lặp.** Chỉ `?page=N` (2–10.000) trên `/shop` và
   `/collections/<slug>` được index và tự-canonical; mọi biến thể fail-closed thành noindex.
6. **Sitemap chỉ chứa URL thật.** Loại sản phẩm inactive/không hiện diện/sai shop, collection
   draft, slug lịch sử; có trần 49.996 URL.
7. **Structured data biết im lặng đúng lúc.** `buildOffer` chỉ phát `offers` khi giá và tồn kho
   nhất quán; `serializeJsonLd` escape `<`.
8. **Nền tảng Core Web Vitals tốt.** `next/image` với `remotePatterns` hẹp, `sizes` đầy đủ,
   `preload` đúng ảnh LCP, không dùng webfont.
9. **Kiểm thử SEO ba tầng**, gồm HTTP smoke qua Next server thật với catalog hai trang được seed.
10. **Tài liệu vận hành nghiêm túc.** `docs/operations/p12-search-exposure.md` có checklist 6 bước
    trước khi bật index và quy trình rollback.

## Điểm yếu

### Nghiêm trọng

- **W1 — Toàn site đang noindex trong production.** `SEARCH_INDEXING_ENABLED=false` trên
  `la.lanadesign.vn`. Điểm SEO thực tế bằng 0 bất kể chất lượng mã nguồn. Đây là quyết định có
  chủ đích (ADR 0004) nhưng nên được quản trị như khoản nợ có hạn chót.
- **W2 — Slug kỹ thuật nằm trong tiêu đề hiển thị.** `src/seo/product-metadata.ts:29` nối slug
  vào sau tên: `Áo Oxford Relaxed nam — ao-oxford-relaxed-den — LA Clothing`; description kết
  thúc bằng `— /shop/<slug>.` Lý do (đảm bảo unique khi DB không ràng buộc) hợp lý, nhưng cái giá
  rơi đúng vào đoạn văn bản người mua đọc trước khi click.
- **W3 — Sản phẩm giảm giá mất giá và mất Offer.** `resolveStorefrontPrice`
  (`src/commerce/storefront-product.ts:50`) trả `null` khi
  `retailPrice !== retailPriceAfterDiscount` → `PRICE_UNRESOLVED` → không purchasable → card hiện
  "Giá đang cập nhật" và JSON-LD không có `offers`. Fail-closed có chủ đích, khoá bằng test, nhưng
  hệ quả thương mại lớn nhất trong bản audit.
- **W4 — Offer bị bỏ khi các biến thể khác giá.** `buildOffer` yêu cầu mọi giá bằng nhau tuyệt
  đối. `getStorefrontResolvedPriceRange` đã tồn tại sẵn cho `AggregateOffer`.

### Trung bình

- **W5 — Product schema thiếu trường thương mại**: `sku`, `gtin13`, `itemCondition`, `color`,
  `size`, `priceValidUntil`, `hasMerchantReturnPolicy`, `shippingDetails`.
  `VariantMirror.pancakeDisplayId` và `pancakeBarcode` đã có sẵn trong DB.
- **W6 — Organization quá mỏng.** Chỉ `name` + `url`; thiếu `logo`, `sameAs`, `contactPoint`,
  `address` — chính là tập dữ liệu Knowledge Graph và LLM dùng để nhận diện thương hiệu.
- **W7 — Không có `potentialAction: SearchAction`** dù `/search` → `/shop?q=` đã chạy.
- **W8 — Không có OG/Twitter mặc định.** Chỉ PDP có. Chia sẻ trang chủ/collection/lookbook lên
  mạng xã hội không có ảnh, không mô tả — mâu thuẫn với việc đã đầu tư Meta Pixel + CAPI. Ảnh
  social card đã tồn tại tại `/la-clothing-modern-menswear-social-card.png`.
- **W9 — Sitemap không có `lastModified`**, dù `updatedAt` đã có ở cả `ProductMirror` lẫn
  `CollectionDefinition`.
- **W10 — `/`, `/collections`, `/lookbook` không có canonical.**
  `CATALOG_LISTING_PATH_PATTERNS` chỉ khớp `/shop` và `/collections/<slug>`.
- **W11 — Hai trang rỗng được link toàn site.** `/new-arrivals` và `/search` là stub tĩnh, đồng
  thời bị noindex, nhưng được link từ header và footer trên mọi trang.
- **W12 — Không có `ItemList`/`CollectionPage`** cho trang danh mục; `/shop` không có JSON-LD nào.
- **W13 — Không có trang nội dung nào để AI trích dẫn.** Không `/ve-chung-toi`, chính sách đổi
  trả, vận chuyển, hướng dẫn size, liên hệ. `buildPublicBrandFacts` đã đóng gói sẵn các fact và
  có test riêng, nhưng chỉ render trong footer. Điểm yếu GEO lớn nhất và dễ sửa nhất.
- **W14 — Không có `not-found.tsx`.** 404 mặc định của Next: không branding, không điều hướng.
- **W15 — Năm smoke test SEO không chạy ở CI.** `search-exposure-http-smoke.ts`,
  `structured-data-http-smoke.ts`, `product-metadata-http-smoke.ts`, `oai-robots-http-smoke.ts`,
  `product-slug-http-smoke.ts` tồn tại và được viện dẫn trong tài liệu, nhưng không workflow nào
  gọi và không có script npm tương ứng. Năm contract này có thể regress im lặng.

### Nhỏ

- **W16 — Form SEO admin không hướng dẫn.** `seoTitle` cho 500 ký tự, `seoDescription` 2.000
  (SERP cắt ở ~60/~155); không đếm ký tự, không preview snippet thật.
- **W17 — Admin không lọc được sản phẩm thiếu nội dung SEO.** `ADMIN_PRODUCT_HEALTH_FILTERS`
  không có chiều `missing-seo` / `missing-editorial`.
- **W18 — Chưa xác minh Search Console/Bing**, thiếu `manifest` và `apple-icon`; không có
  `public/` nên phải dùng meta tag hoặc DNS.
- **W19 — Chính sách AI crawler mới nêu tên `OAI-SearchBot`.** `GPTBot`, `ClaudeBot`,
  `PerplexityBot`, `Google-Extended`, `CCBot`, `Bingbot` chỉ rơi vào luật `*`.
- **W20 — Không có `llms.txt`.** Chỉ có ý nghĩa sau khi W13 hoàn thành.
- **W21 — Sitemap đơn.** Vượt trần thì `throw RangeError` chứ chưa có sitemap index; không có
  image sitemap cho ảnh sản phẩm.

## Kế hoạch cải thiện

### Đợt 0 — trước khi bật index (bắt buộc, không đổi contract nào)

1. Bỏ slug khỏi tiêu đề/mô tả hiển thị; thay bằng discriminator có nghĩa (màu hoặc collection) và
   đẩy bảo đảm không trùng lên tầng admin (cảnh báo khi trùng, chặn publish khi trùng tuyệt đối).
   *(W2, W16)*
2. Khai báo `openGraph`/`twitter` mặc định ở root layout, trỏ về social card đã có. *(W8)*
3. Mở canonical cho `/`, `/collections`, `/lookbook`. *(W10)*
4. Thêm `lastModified` vào sitemap từ `updatedAt`. *(W9)*
5. Nối 5 smoke test SEO vào `catalog-indexation-runtime.yml` và thêm script npm. *(W15)*
6. Quyết định số phận `/new-arrivals` và `/search`: cấp nội dung thật cho `/new-arrivals` và đưa
   vào `INDEXABLE_PATH_PATTERNS`; giữ `/search` noindex nhưng bỏ khỏi footer. *(W11)*
7. Thêm `not-found.tsx` có branding và điều hướng. *(W14)*
8. Chuẩn bị xác minh Search Console và Bing Webmaster. *(W18)*

### Đợt 1 — dữ liệu thương mại & structured data

9. Xem lại contract giá khuyến mãi: chạy `pnpm pancake:catalog:audit` trên dữ liệu thật, rồi cân
   nhắc coi `retailPriceAfterDiscount < retailPrice` là hợp lệ thay vì `PRICE_UNRESOLVED`. *(W3)*
10. Dùng `AggregateOffer` khi các biến thể khác giá. *(W4)*
11. Bổ sung `sku`, `gtin13`, `color`, `size`, `itemCondition`, `priceValidUntil`; giữ tinh thần
    fail-closed — trường nào không đáng tin thì bỏ hẳn. *(W5)*
12. Làm giàu `Organization` và thêm `SearchAction`. *(W6, W7)*
13. Thêm `ItemList`/`CollectionPage` và `BreadcrumbList` cho `/shop`. *(W12)*

### Đợt 2 — nội dung & GEO

14. Dựng `/ve-chung-toi`, `/chinh-sach-doi-tra`, `/van-chuyen-thanh-toan`, `/huong-dan-chon-size`,
    `/lien-he`; mở rộng `buildPublicBrandFacts` thành nguồn duy nhất cho cả footer lẫn các trang
    này. *(W13)*
15. Phát `FAQPage` schema sinh trực tiếp từ các fact đó. *(W13)*
16. Đưa `sizeGuide`/`careInstructions` vào JSON-LD dưới dạng `additionalProperty`. *(W5, W13)*
17. Ghi chính sách AI crawler thành quyết định tường minh kèm `llms.txt`. *(W19, W20)*

### Đợt 3 — độ dễ vận hành

18. Preview snippet thật + bộ đếm ký tự (ngưỡng 60/155) trong form admin. *(W16)*
19. Thêm chiều health `missing-seo` / `missing-editorial` và widget "độ sẵn sàng SEO". *(W17)*
20. Image sitemap và sitemap index. *(W21)*
21. Nâng bằng chứng hiệu năng P18 thành ngưỡng chặn (budget LCP/CLS/INP).

## Ước lượng công sức

Theo quy ước PR nhỏ, một mối quan tâm mỗi PR (ADR 0005), đã tính cả test và tài liệu.

| Đợt | Nội dung | Số PR ước tính | Rủi ro |
| --- | --- | --- | --- |
| 0 | Trước khi bật index — 8 hạng mục, thuần cộng thêm | 6–8 | Thấp — không đổi contract |
| 1 | Dữ liệu thương mại & structured data | 5–6 | Trung bình — contract giá cần chứng cứ từ dữ liệu Pancake thật |
| 2 | Nội dung & GEO | 4–5 | Thấp về kỹ thuật — nút thắt là nội dung do người viết |
| 3 | Công cụ vận hành | 4 | Thấp — nội bộ admin, không chạm storefront |
