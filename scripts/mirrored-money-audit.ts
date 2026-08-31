/**
 * Pre-rollout mirrored money-data audit (#151 P2, #152 W3).
 *
 * Read-only. Prints a bounded, sanitized summary of how the mirrored Pancake base prices fare
 * against the positive-safe-integer website money rule, and how often the mirrored discount field
 * disagrees with base. It changes nothing and decides nothing.
 *
 *   DATABASE_URL=... PANCAKE_SHOP_ID=... pnpm money:audit
 */

import { readMirroredVariantMoneyRows } from "../src/commerce/mirrored-money-audit-repository.ts";
import { summarizeMirroredMoney } from "../src/commerce/mirrored-money-audit.ts";
import { prisma } from "../src/db/prisma.ts";
import { readPancakeConfig } from "../src/integrations/pancake/config.ts";

try {
  const { shopId } = readPancakeConfig();
  const summary = summarizeMirroredMoney(await readMirroredVariantMoneyRows(shopId));

  console.log("MIRRORED_MONEY_AUDIT_BEGIN");
  console.log(JSON.stringify({ pancakeShopId: shopId, ...summary }, null, 2));
  console.log("MIRRORED_MONEY_AUDIT_END");
} catch (error) {
  console.error(`Mirrored money audit failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
