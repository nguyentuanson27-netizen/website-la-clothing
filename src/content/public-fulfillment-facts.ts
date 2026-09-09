export const PUBLIC_RETURN_LOGISTICS_FACTS = Object.freeze({
  returnMethods: Object.freeze({
    inStore: "Trả trực tiếp tại cửa hàng / địa điểm kinh doanh.",
    byMail: "Gửi trả qua đường vận chuyển / bưu gửi.",
    byMailResponsibility: "Khách hàng tự chịu trách nhiệm gửi hàng và nhãn/phiếu gửi trả.",
  }),
  restockingFeeVnd: 0,
  restockingFeeNote: "Không thu phí restocking.",
});

/**
 * Human-facing labels for the delivery windows already owned by `PUBLIC_DELIVERY_FACTS`.
 *
 * The detailed 48-ward operational mapping stays in the owner-decision document because the public
 * policy only needs to tell a buyer which of the two approved scopes applies. This constant prevents
 * `/shipping` from collapsing the facts into the ambiguous historical labels “Nội thành” and
 * “Ngoại tỉnh”.
 */
export const PUBLIC_DELIVERY_SCOPE_LABELS = Object.freeze({
  innerCity: "Nội thành Hà Nội",
  otherProvince: "Ngoài nội thành Hà Nội / các tỉnh, thành khác",
});
