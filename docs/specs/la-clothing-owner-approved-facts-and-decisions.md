# LA Clothing — Owner-approved public facts & operational decisions

**Status:** Consolidated owner-approved source of truth  
**Last updated:** 2026-09-09  
**Owner / brand authority:** `@nguyentuanson27-netizen`

> Tài liệu này tổng hợp các fact, policy và owner decision đã được xác nhận cho LA Clothing.
> Coding agent không được tự suy diễn thêm business fact ngoài tài liệu này.
> Các mục ghi `OPEN` vẫn phải fail-closed / blocked theo master plan cho tới khi owner cập nhật.

---

# 1. Brand & legal identity

## Brand
- **Brand name:** LA Clothing
- **Brand positioning:** Minimal, modern menswear by LA Clothing.
- **Product category:** Thời trang nam
- **Founding year:** Không công khai
- **Founder / people:** Không công khai
- **Brand story / values:** Chưa chốt — không tự viết/infer

## Operating / selling entity
- **Đơn vị bán hàng / vận hành:** CÔNG TY TNHH QUỐC TẾ THƯƠNG MẠI LAS
- **Địa chỉ kinh doanh:** 212 Nguyễn Trãi, Đại Mỗ, Hà Nội
- **Mã số thuế / GCN ĐKKD nếu có:** 0111242251
- **Owner confirmation:** MST `0111242251` thuộc CÔNG TY TNHH QUỐC TẾ THƯƠNG MẠI LAS.

## Domain
- **Current website:** https://la.lanadesign.vn
- `la.lanadesign.vn` vẫn là temporary production domain.
- **Permanent branded domain:** `OPEN — làm sau`
- Không coi tài liệu này là phê duyệt bật organic indexing.

---

# 2. Contact & support facts

- **Hotline/Zalo:** 0923159666
- **Email:** [laclothing2025@gmail.com](mailto:laclothing2025@gmail.com)
- **Fanpage:** https://www.facebook.com/LAclothing.vn
- **Địa chỉ:** 212 Nguyễn Trãi, Đại Mỗ, Hà Nội
- **Giờ hỗ trợ:** 08:00 - 22:00 hằng ngày (UTC+7)

Có thể dùng các fact trên cho Contact page, footer, `Organization.contactPoint`, `Organization.address`, và `sameAs`.

**B2 status:** `RESOLVED`

---

# 3. Checkout & payment

- Khách hàng không bắt buộc đăng ký tài khoản để đặt hàng.
- Giá, tồn kho và phí vận chuyển có thể được server kiểm tra lại tại thời điểm đặt hàng.
- **Payment public hiện tại:** COD — thanh toán khi nhận hàng.
- Không công bố chuyển khoản/card/wallet như checkout method nếu website chưa thực sự hỗ trợ.
- Refund cho đơn COD có thể thực hiện qua chuyển khoản ngân hàng hoặc phương thức phù hợp được thống nhất với khách hàng.

---

# 4. Returns / exchanges / refunds

## Return window
- Hỗ trợ đổi/trả trong vòng **15 ngày kể từ ngày khách hàng nhận hàng**.

## Điều kiện sản phẩm
Sản phẩm đổi/trả phải:
- còn mới;
- chưa qua sử dụng;
- còn đầy đủ tem/mác;
- không rách, bẩn, hư hỏng;
- không có mùi lạ;
- không có dấu hiệu đã qua sử dụng;
- đúng sản phẩm được mua từ LA Clothing;
- gửi lại theo hướng dẫn của bộ phận hỗ trợ.

## Trường hợp được hỗ trợ
- Sản phẩm lỗi / có vết bẩn từ phía sản xuất.
- LA Clothing giao sai mẫu.
- Giao sai màu.
- Giao sai size.
- Khách hàng chủ động đổi sang mẫu khác.
- Khách hàng mua đúng hàng nhưng muốn đổi size hoặc đổi màu.

## Return methods — owner-approved 2026-09-09
Khách hàng có thể trả hàng bằng **cả hai** phương thức:
- **trả trực tiếp tại cửa hàng / địa điểm kinh doanh**;
- **gửi trả qua đường vận chuyển / bưu gửi**.

Đối với gửi trả qua đường vận chuyển:
- **khách hàng tự chịu trách nhiệm gửi hàng và nhãn/phiếu gửi trả**;
- không được claim LA Clothing cung cấp prepaid return label nếu chưa có quyết định mới.

## Customer-initiated exchange
Nếu khách hàng chủ động đổi mẫu / size / màu:
- **Phí đổi: 50.000 đồng / 01 sản phẩm**
- **Khách hàng chịu phí vận chuyển hai chiều**

## Shop/manufacturer fault
Nếu LA Clothing giao sai hoặc lỗi thuộc shop / nhà sản xuất:
- **LA Clothing chịu toàn bộ phí vận chuyển hợp lý cho việc đổi/trả.**

## Restocking fee — owner-approved 2026-09-09
- **Không thu restocking fee: 0 VND.**
- Phí đổi `50.000 VND / sản phẩm` ở customer-initiated exchange **không phải** restocking fee và không được map sang field restocking fee của Merchant Center.

## Non-returnable categories
- **Không có danh mục loại trừ riêng.**
- Chỉ áp dụng các điều kiện từ chối đã nêu trong chính sách.

## Refund
- Thời gian hoàn tiền dự kiến trên website: **7–10 ngày làm việc** kể từ khi LA Clothing nhận lại sản phẩm, kiểm tra và xác nhận đủ điều kiện hoàn tiền.
- **Merchant Center operational mapping — owner-approved 2026-09-09:** dùng giá trị số **`10`** cho field refund processing time như upper-bound numeric mapping của policy hiện tại. Việc map này **không thay đổi** public wording `7–10 ngày làm việc` trên website.
- Nếu Merchant Center UI tại thời điểm cấu hình đưa ra semantics khác materially so với một numeric processing-time field, phải ghi nhận UI thực tế trước khi save; không tự sửa public policy để fit vendor UI.

**B1 status:** `RESOLVED`

---

# 5. Shipping policy

## Coverage
- **Giao hàng toàn quốc**

## Carrier
- **GHN**
- **GHTK**

Có thể dùng wording customer-facing là “đơn vị vận chuyển phù hợp” nếu không muốn hard-code carrier ở mọi surface.

## Delivery estimate
- **Nội thành Hà Nội:** 1–3 ngày
- **Ngoài nội thành Hà Nội / các tỉnh, thành khác:** 3–15 ngày

Đây là thời gian dự kiến, không phải guaranteed SLA tuyệt đối.

### “Nội thành Hà Nội” — owner-approved operational geography 2026-09-09
Owner xác nhận tier 1–3 ngày áp dụng cho **nội thành Hà Nội** và yêu cầu dùng ranh giới hành chính hiện hành thay vì tự đặt quận/huyện cũ.

Cơ sở hành chính:
- Trước đợt sắp xếp 2025, Hà Nội có **12 quận nội thành/trung tâm**: Ba Đình, Bắc Từ Liêm, Cầu Giấy, Đống Đa, Hà Đông, Hai Bà Trưng, Hoàn Kiếm, Hoàng Mai, Long Biên, Nam Từ Liêm, Thanh Xuân, Tây Hồ.
- Nghị quyết 1656/NQ-UBTVQH15 năm 2025 tổ chức lại cấp xã của Hà Nội. Để giữ continuity với phạm vi 12 quận nội thành cũ, operational mapping hiện tại dùng **48 phường mới tại khoản 1–48 Điều 1**, và **không** coi các phường Chương Mỹ, Sơn Tây, Tùng Thiện (các khoản 49–51) là tier “nội thành Hà Nội” này.

48 phường operationally thuộc tier nội thành 1–3 ngày:
1. Hoàn Kiếm
2. Cửa Nam
3. Ba Đình
4. Ngọc Hà
5. Giảng Võ
6. Hai Bà Trưng
7. Vĩnh Tuy
8. Bạch Mai
9. Đống Đa
10. Kim Liên
11. Văn Miếu - Quốc Tử Giám
12. Láng
13. Ô Chợ Dừa
14. Hồng Hà
15. Lĩnh Nam
16. Hoàng Mai
17. Vĩnh Hưng
18. Tương Mai
19. Định Công
20. Hoàng Liệt
21. Yên Sở
22. Thanh Xuân
23. Khương Đình
24. Phương Liệt
25. Cầu Giấy
26. Nghĩa Đô
27. Yên Hòa
28. Tây Hồ
29. Phú Thượng
30. Tây Tựu
31. Phú Diễn
32. Xuân Đỉnh
33. Đông Ngạc
34. Thượng Cát
35. Từ Liêm
36. Xuân Phương
37. Tây Mỗ
38. Đại Mỗ
39. Long Biên
40. Bồ Đề
41. Việt Hưng
42. Phúc Lợi
43. Hà Đông
44. Dương Nội
45. Yên Nghĩa
46. Phú Lương
47. Kiến Hưng
48. Thanh Liệt

Source references reviewed 2026-09-09:
- Nghị quyết 1656/NQ-UBTVQH15: https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-quyet-so-1656-nq-ubtvqh15-sap-xep-cac-dvhc-cap-xa-cua-thanh-pho-ha-noi-nam-2025-119250616192433872.htm
- Hà Nội pre-reform 12-quận core description: https://phuchoa.phuctho.hanoi.gov.vn/tin-chi-tiet/-/chi-tiet/cong-khai-du-thao-phuong-an-sap-xep-on-vi-hanh-chinh-cap-xa-cua-thanh-pho-ha-noi-5744-175.html

This is an **LA Clothing shipping-policy operational mapping**, not a claim that “nội thành” remains a formal post-2025 administrative level.

## Merchant Center shipping-speed compatibility
Current Google Merchant Center documentation reviewed 2026-09-09 shows Vietnam supports regions for regional availability/pricing, but **does not list Vietnam as supporting shipping cost/transit-time custom areas or postal-code shipping-speed regions**.

Therefore:
- website/checkout keeps the truthful 1–3 day inner-Hanoi vs 3–15 day outside-inner-Hanoi policy;
- Merchant Center must not invent an unsupported custom shipping-speed region for Vietnam;
- when Merchant account access is available, configure the broadest truthful supported delivery-time representation, using **3–15 days nationwide** as the initial conservative target if the account UI cannot express the inner-Hanoi split;
- do not promise a faster Merchant delivery time than checkout can meet;
- if the UI requires a separate handling/transit split, observe the actual available controls and operational handling facts before final save rather than inventing processing days.

Google references:
- https://support.google.com/merchants/answer/15406457
- https://support.google.com/merchants/answer/12577710
- https://support.google.com/merchants/answer/14949917

## Carrier tracking
- **Mặc định không cung cấp mã vận đơn / link tracking GHN/GHTK cho khách hàng.**
- Không claim carrier-level tracking nếu customer-facing flow không cung cấp nó.

## Phone confirmation
- Gọi điện xác nhận đơn trước giao hàng **không phải policy bắt buộc mặc định**.
- LA Clothing **vẫn có thể gọi khi cần** để xác minh đơn hàng, địa chỉ hoặc thông tin giao nhận.

Recommended wording:
> “LA Clothing có thể liên hệ để xác minh đơn hàng khi cần.”

## Existing shipping-price policy
Giữ current server-owned shipping policy cho tới khi owner thay đổi:
- Phí ship mặc định: **30.000 VND**
- Free shipping nếu:
  - subtotal **trên 1.000.000 VND**, hoặc
  - từ **3 sản phẩm**
- Runtime/server config vẫn là authority nếu production env có override hợp lệ.
- **Production confirmation 2026-09-09:** owner xác nhận VPS production hiện dùng đúng các giá trị trên. Đây là owner-provided production confirmation, không phải independent SSH/runtime observation của coding agent.

Merchant mapping rule:
- ưu tiên match chính xác nếu Merchant account UI support được cả order-value và item-count condition;
- nếu UI không biểu diễn được điều kiện `>= 3 sản phẩm`, không được submit mức thấp hơn checkout; Google cho phép overestimate nhẹ khi không thể match chính xác, vì vậy giữ `30.000 VND` cho case không biểu diễn được sẽ an toàn hơn việc quảng cáo free shipping sai.

**B4 status:** `RESOLVED`

---

# 6. Size guide

## Measurement semantics
- **Tất cả số đo quần áo:** cm
- `Rộng ngực`, `Rộng eo`, `Rộng mông` là **số đo vòng quanh sản phẩm**, không phải đo ngang khi trải phẳng.
- **Tolerance sai số may mặc:** **±3 cm**
- Chiều cao/cân nặng là guidance chọn size, không phải bảo đảm fit tuyệt đối.

## Size chart A — sản phẩm dáng rộng / quần lưng chun

| Thông số | M | L | XL | 2XL |
|---|---:|---:|---:|---:|
| Rộng ngực (vòng, cm) | 106 | 110 | 114 | 118 |
| Dài tay (cm) | 55 | 56 | 57 | 58 |
| Dài áo (cm) | 63.5 | 65.5 | 67.5 | 69.5 |
| Dài quần (cm) | 105 | 106 | 107 | 108 |
| Rộng eo — chun (vòng, cm) | 70–80 | 74–84 | 78–88 | 82–92 |
| Rộng mông (vòng, cm) | 108 | 112 | 116 | 120 |
| Chiều cao tham khảo | 1m60–1m85 | 1m60–1m85 | 1m60–1m85 | 1m60–1m85 |
| Cân nặng tham khảo (kg) | 50–59 | 60–69 | 70–79 | 80–89 |

**Tolerance:** ±3 cm.

## Size chart B — áo ngắn tay

| Thông số | M | L | XL | 2XL |
|---|---:|---:|---:|---:|
| Rộng ngực (vòng, cm) | 120 | 124 | 128 | 132 |
| Dài áo (cm) | 63 | 65 | 67 | 69 |
| Dài tay (cm) | 27 | 28 | 29 | 30 |
| Chiều cao tham khảo | 1m60–1m85 | 1m60–1m85 | 1m60–1m85 | 1m60–1m85 |
| Cân nặng tham khảo (kg) | 50–59 | 60–69 | 70–79 | 80–89 |

**Tolerance:** ±3 cm.

**B3 status:** `RESOLVED`

---

# 7. About / legal content

Owner decisions:
- Không công khai năm thành lập.
- Chưa chốt brand story / brand values.
- Không công khai founder / people.
- Có thể public brand name, brand positioning hiện tại, legal entity, địa chỉ, contact và MST đã owner xác nhận.

Không invent:
- lịch sử thương hiệu;
- founding year;
- founder bio;
- brand mission/values ngoài current brand positioning.

Minimal About page có thể dùng:
> “LA Clothing là thương hiệu thời trang nam theo định hướng tối giản, hiện đại.”

**B6 status:** `RESOLVED FOR MINIMAL ABOUT PAGE`  
**Brand story / values:** `OPEN — optional future content`

---

# 8. SEO metadata uniqueness — B5

## Strategy
**Enforce uniqueness**, không dùng discriminator mới để thay slug.

## Scope
Uniqueness ở mức **pair-level**:
`(seoTitle, seoDescription)`

Hai sản phẩm có thể cùng `seoTitle` nếu `seoDescription` khác.

## Draft behavior
- `seoTitle` có thể thiếu.
- `seoDescription` có thể thiếu.
- Copy có thể trùng.
- Admin nên hiển thị warning nếu phát hiện collision.

## Publish behavior
Muốn chuyển sang `PUBLISHED`:
- `seoTitle` bắt buộc có text.
- `seoDescription` bắt buộc có text.
- Pair `(seoTitle, seoDescription)` phải unique giữa các sản phẩm published.
- Collision => **BLOCK PUBLISH**.

Sau khi enforcement + real-catalog verification pass, U29/W2b có thể bỏ slug/path kỹ thuật khỏi metadata.

**B5 status:** `RESOLVED — OWNER APPROVED`

---

# 9. Crawler governance — U36 / W19

Owner decision: **ALLOW toàn bộ crawler categories**

- Traditional search discovery/indexing: ALLOW
- User-triggered retrieval / AI search assistants: ALLOW
- Model training crawlers: ALLOW
- Vendor-specific crawlers: ALLOW, trừ khi có future owner override

Lưu ý:
- “Allow crawler” không có nghĩa là tự bật organic indexing.
- Không được override `SEARCH_INDEXING_ENABLED` / temporary-domain gate.

**U36 owner policy:** `RESOLVED — ALLOW ALL`

---

# 10. Permanent domain / Gate S

- **Permanent branded domain:** `OPEN — làm sau`
- `la.lanadesign.vn` vẫn là temporary domain.
- Không enable organic indexing trên temporary domain.

U35 / Gate S vẫn chờ:
1. Permanent branded domain.
2. DNS / TLS / routing.
3. Search Console verification.
4. Bing Webmaster verification.
5. Applicable Merchant/site verification nếu cần.
6. Fresh activation-time sitemap capacity audit.
7. Explicit human approval.

**U35 status:** `OPEN / DEFERRED`

---

# 11. Google Ads Purchase value — O1

Owner decision:
**Google Ads Purchase value = merchandise-only**

Meaning:
- Conversion value chỉ phản ánh **giá trị hàng hóa**.
- Không cộng shipping fee vào Google Ads Purchase value.
- Implementation phải reuse authoritative immutable order merchandise value / canonical purchase facts.
- Không tự tính lại tiền từ browser payload.

**O1 status:** `RESOLVED — MERCHANDISE-ONLY`

---

# 12. Merchant market — O2

- **Country / market:** Việt Nam
- **Language:** `vi`
- **Currency:** `VND`

**O2 status:** `RESOLVED`

---

# 13. GTM / vendor configuration — O4

Chưa có cụ thể:
- GTM Container ID
- GA4 Measurement ID
- Google Ads Conversion ID
- Google Ads Conversion Label
- TikTok Pixel ID

Decision:
- Có thể **setup config/schema/placeholders trước để điền sau**.
- Placeholder/default phải **fail-closed**:
  - không load GTM thật;
  - không gửi production analytics/ad destination;
  - không mở CSP origin không cần thiết.
- Không hard-code dummy ID thành production value.
- O4 chưa complete cho tới khi real IDs được proper account owner cung cấp + review.

**O4 status:** `OPEN — PLACEHOLDER SETUP ALLOWED, LIVE BLOCKED`

---

# 14. Merchant ↔ JSON-LD family-collapse decision

Owner-approved technical convergence contract when filtering leaves **exactly one publishable standalone variant**:

1. **Merchant continues to publish the exact surviving variant.** Do not weaken a correct feed merely to match a structured-data presentation rule.
2. **U27 emits a standalone schema.org `Product` representing that same exact survivor**, using the same U12 variant deep-link and the same verified variant facts used by the exact variant path: manufacturer MPN, optional publishable SKU, color/size, image where resolved, exact promotion-aware price and exact resolved availability.
3. **Do not emit a one-member `ProductGroup`.** A single surviving standalone product is represented as `Product`, not a fake family.
4. If zero standalone variants remain publishable, publish no exact standalone-variant claim.
5. The feed↔JSON-LD convergence gate closes only after a dedicated implementation PR proves exact survivor parity for variation identity, URL, MPN, price and availability. **PR #214** implemented the contract and proved identity, URL, MPN and availability, merging as `be7e5f628f86e71f8fc9769bed210501e15e03ed`; **PR #216** supplied the missing discriminating **promotion-aware price** proof, which no earlier collapse-state case made. The clause is satisfied only once both are counted.

**Status:** `RESOLVED — IMPLEMENTED BY PR #214, PROOF SET COMPLETED BY PR #216`

Implementation and parity evidence: `docs/audits/merchant-jsonld-parity.md`. Closing this convergence gate removes the parity blocker only; it activates no Merchant destination, which still requires the trusted O2 runtime authority and the remaining Gate M prerequisites.

---

# 15. Public policy pages

Các page/policy được owner đồng ý dùng cho website:

1. Điều khoản chung
2. Chính sách vận chuyển
3. Chính sách đổi trả và hoàn tiền
4. Chính sách giá
5. Chính sách thanh toán
6. Chính sách bảo mật
7. Thông tin liên hệ
8. Các hình thức hỗ trợ trực tuyến
9. Các điều kiện và hạn chế trong việc cung cấp hàng hóa
10. Chính sách tiếp nhận và giải quyết phản ánh khiếu nại
11. Quyền và nghĩa vụ của các bên trên nền tảng

Các page nên consume một source-of-truth chung cho contact/legal/policy facts thay vì copy hard-code độc lập.

---

# 16. Gate-resolution summary

| Gate / Unit | Status | Decision / blocker |
|---|---|---|
| B1 Returns | ✅ RESOLVED | 15 ngày; return in-store + by mail; mail label/shipping customer responsibility; restocking 0; đổi mẫu/size/màu 50k + 2-way ship nếu customer-initiated; shop/manufacturer fault thì LA Clothing chịu ship; refund website 7–10 working days, Merchant numeric mapping 10; no separate excluded categories |
| B2 Contact / U32b | ✅ RESOLVED | Phone, email, address, hours, Fanpage approved |
| B3 Size Guide | ✅ RESOLVED | 2 size charts, cm, circumference semantics, ±3 cm tolerance |
| B4 Shipping | ✅ RESOLVED | Nationwide, GHN/GHTK, 1–3 days current 48-ward inner-Hanoi operational footprint, 3–15 days elsewhere, no default carrier tracking, phone confirmation optional; production shipping values owner-confirmed 30k / >1M / >=3 items |
| B5 Metadata uniqueness / U29 | ✅ RESOLVED | Pair-level unique on publish; draft warning; collision blocks publish |
| B6 About/legal | ✅ RESOLVED FOR MINIMAL PAGE | No founding year/founder; no invented story; legal entity + MST + contact may be public |
| U35 / Permanent domain | ⏳ OPEN | Permanent domain deferred |
| U36 crawler governance | ✅ RESOLVED | Allow all crawler categories |
| O1 Google Ads value | ✅ RESOLVED | Merchandise-only |
| O2 Merchant market | ✅ RESOLVED | Vietnam / vi / VND |
| O4 vendor IDs | ⏳ OPEN | Placeholder setup allowed; live blocked |
| Merchant↔JSON-LD family collapse | ✅ RESOLVED — IMPLEMENTED (#214), PROVED (#216) | Merchant keeps exact survivor; U27 standalone `Product` represents the same exact survivor; no one-member `ProductGroup` |

---

# 17. Engineering unlocks

## Can proceed
- U29 / W2b
- U32b / W6
- U33 / W13
- U36 / W19
- O1/O2-dependent Ads/Merchant planning
- U41 / M5 operational setup once Merchant Center account access is connected; owner-fact blockers for return methods/restocking/refund numeric mapping/inner-Hanoi geography are resolved.

## Still blocked / deferred
- U35 — permanent domain not chosen.
- Gate T live — O4 real vendor IDs missing.
- Merchant activation (Gate M) — external Merchant Center account access / observed account state is still required for website verification/claim, shipping/returns save, Scheduled Fetch, Diagnostics and Ads linkage. Trusted O2 runtime authority and feed↔JSON-LD parity are already closed.
- Gate S activation — separate human gate.
- Brand story / values — optional future content.

---

# 18. Owner approval record

Owner confirms the facts/decisions in this document as current business truth for LA Clothing as of **2026-09-09**, except sections explicitly marked `OPEN`.

**Approved by:** `@nguyentuanson27-netizen`  
**Approval date:** `2026-09-09`

Any future change to return window/methods/fees, shipping terms/geography/delivery estimates/carriers, size measurements/tolerance, contact/legal facts, crawler policy, Ads value semantics, Merchant target market, SEO publish uniqueness policy, or the Merchant↔JSON-LD one-survivor convergence contract should update this source-of-truth before implementation/publication changes rely on the new value.