import { PancakeClient } from "../src/integrations/pancake/client.ts";
import { readPancakeConfig } from "../src/integrations/pancake/config.ts";
import { describeJsonShape } from "../src/integrations/pancake/json-shape.ts";
import {
  assertReviewedPancakeContractKeysConfigured,
  REVIEWED_PANCAKE_CONTRACT_KEYS,
} from "../src/integrations/pancake/reviewed-contract-keys.ts";

function verificationOptions(allowedObjectKeys: readonly string[]) {
  return {
    allowedObjectKeys,
    rejectUnknownObjectKeys: true,
    maxObjectFields: Math.max(allowedObjectKeys.length, 1),
  } as const;
}

async function main() {
  assertReviewedPancakeContractKeysConfigured();

  const config = readPancakeConfig();
  const client = new PancakeClient({ apiKey: config.apiKey });

  const [productVariations, warehouses] = await Promise.all([
    client.getJson(`/shops/${config.shopId}/products/variations`),
    client.getJson(`/shops/${config.shopId}/warehouses`),
  ]);

  const contractShapes = {
    productVariations: describeJsonShape(
      productVariations,
      verificationOptions(REVIEWED_PANCAKE_CONTRACT_KEYS.productVariations),
    ),
    warehouses: describeJsonShape(
      warehouses,
      verificationOptions(REVIEWED_PANCAKE_CONTRACT_KEYS.warehouses),
    ),
  };

  console.log("PANCAKE_REVIEWED_CONTRACT_VERIFICATION_BEGIN");
  console.log(JSON.stringify(contractShapes, null, 2));
  console.log("PANCAKE_REVIEWED_CONTRACT_VERIFICATION_END");
}

try {
  await main();
} catch {
  console.error(
    "Pancake reviewed-contract verification failed without logging external values or unknown field names",
  );
  process.exitCode = 1;
}
