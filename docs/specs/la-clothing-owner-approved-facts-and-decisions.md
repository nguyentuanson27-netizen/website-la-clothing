# LA Clothing — Owner-approved public facts & operational decisions

**Status:** Consolidated owner-approved source of truth  
**Last updated:** 2026-09-07  
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

## Customer-initiated exchange
Nếu khách hàng chủ động đổi mẫu / size / màu:
- **Phí đổi: 50.000 đồng / 01 sản phẩm**
- **Khách hàng chịu phí vận chuyển hai chiều**

## Shop/manufacturer fault
Nếu LA Clothing giao sai hoặc lỗi thuộc shop / nhà sản xuất:
- **LA Clothing chịu toàn bộ phí vận chuyển hợp lý cho việc đổi/trả.**

## Non-returnable categories
- **Không có danh mục loại trừ riêng.**
- Chỉ áp dụng các điều kiện từ chối đã nêu trong chính sách.

## Refund
- Thời gian hoàn tiền dự kiến: **7–10 ngày làm việc** kể từ khi LA Clothing nhận lại sản phẩm, kiểm tra và xác nhận đủ điều kiện hoàn tiền.

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
- **Nội thành:** 1–3 ngày
- **Ngoại tỉnh:** 3–15 ngày

Đây là thời gian dự kiến, không phải guaranteed SLA tuyệt đối.

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

Current roadmap còn một authority decision kỹ thuật khi family chỉ còn **1 publishable variant**.

Known divergence:
- Merchant có thể publish exact surviving variant.
- JSON-LD hiện có thể collapse family thành product-level `Product`.

Engineering phải đưa proposal riêng với trade-off tối thiểu giữa:
1. Giữ exact surviving variant trong structured data; hoặc
2. Omit survivor khỏi Merchant để giữ exact set parity.

**Status:** `OPEN — ENGINEERING PROPOSAL REQUIRED`

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
| B1 Returns | ✅ RESOLVED | 15 ngày; đổi mẫu/size/màu; 50k + 2-way ship nếu customer-initiated; shop/manufacturer fault thì LA Clothing chịu ship; no separate excluded categories |
| B2 Contact / U32b | ✅ RESOLVED | Phone, email, address, hours, Fanpage approved |
| B3 Size Guide | ✅ RESOLVED | 2 size charts, cm, circumference semantics, ±3 cm tolerance |
| B4 Shipping | ✅ RESOLVED | Nationwide, GHN/GHTK, 1–3 days inner-city, 3–15 days other provinces, no default carrier tracking, phone confirmation optional |
| B5 Metadata uniqueness / U29 | ✅ RESOLVED | Pair-level unique on publish; draft warning; collision blocks publish |
| B6 About/legal | ✅ RESOLVED FOR MINIMAL PAGE | No founding year/founder; no invented story; legal entity + MST + contact may be public |
| U35 / Permanent domain | ⏳ OPEN | Permanent domain deferred |
| U36 crawler governance | ✅ RESOLVED | Allow all crawler categories |
| O1 Google Ads value | ✅ RESOLVED | Merchandise-only |
| O2 Merchant market | ✅ RESOLVED | Vietnam / vi / VND |
| O4 vendor IDs | ⏳ OPEN | Placeholder setup allowed; live blocked |
| Merchant↔JSON-LD family collapse | ⏳ OPEN | Needs engineering proposal + owner/architecture decision |

---

# 17. Engineering unlocks

## Can proceed
- U29 / W2b
- U32b / W6
- U33 / W13
- U36 / W19
- O1/O2-dependent Ads/Merchant planning

## Still blocked / deferred
- U35 — permanent domain not chosen.
- Gate T live — O4 real vendor IDs missing.
- Merchant↔JSON-LD family-collapse final parity — decision pending.
- Gate S activation — separate human gate.
- Brand story / values — optional future content.

---

# 18. Owner approval record

Owner confirms the facts/decisions in this document as current business truth for LA Clothing as of **2026-09-07**, except sections explicitly marked `OPEN`.

**Approved by:** `@nguyentuanson27-netizen`  
**Approval date:** `2026-09-07`

Any future change to return window, fees, shipping terms, delivery estimates, carriers, size measurements/tolerance, contact/legal facts, crawler policy, Ads value semantics, Merchant target market, or SEO publish uniqueness policy should update this source-of-truth before implementation/publication changes rely on the new value.
