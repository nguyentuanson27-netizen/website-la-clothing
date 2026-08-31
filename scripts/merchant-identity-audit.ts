/**
 * M1 Merchant identity and durability audit (#153 M1, #152 W4a).
 *
 * Read-only. Reports what the mirrored catalog can prove about the identifiers a Merchant feed
 * would emit. It emits no offer, asserts no GTIN, invents no apparel fact, and always reports the
 * durability verdict as blocked until upstream lifetime evidence exists.
 *
 *   DATABASE_URL=... PANCAKE_SHOP_ID=... pnpm merchant:identity:audit
 */

import { prisma } from "../src/db/prisma.ts";
import { readMerchantIdentityRows } from "../src/commerce/merchant-identity-audit-repository.ts";
import { summarizeMerchantIdentity } from "../src/commerce/merchant-identity-audit.ts";
import { readPancakeConfig } from "../src/integrations/pancake/config.ts";

try {
  const { shopId } = readPancakeConfig();
  const summary = summarizeMerchantIdentity(await readMerchantIdentityRows(shopId));

  console.log("MERCHANT_IDENTITY_AUDIT_BEGIN");
  console.log(JSON.stringify({ pancakeShopId: shopId, ...summary }, null, 2));
  console.log("MERCHANT_IDENTITY_AUDIT_END");
} catch (error) {
  console.error(`Merchant identity audit failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
