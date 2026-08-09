import { PancakeClient } from "../src/integrations/pancake/client.ts";
import { readPancakeConfig } from "../src/integrations/pancake/config.ts";
import { describeJsonShape } from "../src/integrations/pancake/json-shape.ts";

async function main() {
  const config = readPancakeConfig();
  const client = new PancakeClient({ apiKey: config.apiKey });

  const [productVariations, warehouses] = await Promise.all([
    client.getJson(`/shops/${config.shopId}/products/variations`),
    client.getJson(`/shops/${config.shopId}/warehouses`),
  ]);

  const contractShapes = {
    productVariations: describeJsonShape(productVariations),
    warehouses: describeJsonShape(warehouses),
  };

  console.log("PANCAKE_CONTRACT_SHAPES_BEGIN");
  console.log(JSON.stringify(contractShapes, null, 2));
  console.log("PANCAKE_CONTRACT_SHAPES_END");
}

try {
  await main();
} catch {
  console.error("Pancake contract probe failed without logging external values");
  process.exitCode = 1;
}
