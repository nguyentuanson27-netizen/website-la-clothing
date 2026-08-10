import {
  PancakeCatalogContractError,
  parsePancakeCatalogVariations,
  parsePancakeWarehouses,
  type PancakeCatalogContractReason,
} from "../src/integrations/pancake/catalog-contract.ts";
import { PancakeClient } from "../src/integrations/pancake/client.ts";
import { readPancakeConfig } from "../src/integrations/pancake/config.ts";
import { describeReviewedJsonShape } from "../src/integrations/pancake/json-shape.ts";
import {
  assertReviewedPancakeContractKeysConfigured,
  REVIEWED_PANCAKE_CONTRACT_KEYS,
} from "../src/integrations/pancake/reviewed-contract-keys.ts";

const PANCAKE_CONTRACT_VALIDATION_NODE_BUDGET = 250_000;

const REVIEWED_JSON_UNKNOWN_FIELD_ERROR = "External object contains an unreviewed field name";
const REVIEWED_JSON_VALIDATION_BUDGET_ERROR =
  "External JSON validation exceeded the inspection budget";
const REVIEWED_JSON_NON_JSON_ERROR = "External value is not JSON-compatible";

type VerificationStage =
  | "configuration"
  | "product-fetch"
  | "warehouse-fetch"
  | "product-key-contract"
  | "warehouse-key-contract"
  | "product-mapped-contract"
  | "warehouse-mapped-contract";

type VerificationReason =
  | "configuration"
  | "transport"
  | "unreviewed-field"
  | "inspection-budget"
  | "non-json"
  | "mapped-contract"
  | "unexpected"
  | PancakeCatalogContractReason;

class PancakeContractVerificationStageError extends Error {
  readonly stage: VerificationStage;
  readonly reason: VerificationReason;

  constructor(stage: VerificationStage, reason: VerificationReason) {
    super(`Pancake contract verification failed at ${stage}`);
    this.name = "PancakeContractVerificationStageError";
    this.stage = stage;
    this.reason = reason;
  }
}

function verificationOptions(allowedObjectKeys: readonly string[]) {
  return {
    allowedObjectKeys,
    maxObjectFields: Math.max(allowedObjectKeys.length, 1),
    maxValidationNodes: PANCAKE_CONTRACT_VALIDATION_NODE_BUDGET,
  } as const;
}

function classifyReviewedJsonFailure(error: unknown): VerificationReason {
  if (!(error instanceof Error)) {
    return "unexpected";
  }

  if (error.message === REVIEWED_JSON_UNKNOWN_FIELD_ERROR) {
    return "unreviewed-field";
  }
  if (error.message === REVIEWED_JSON_VALIDATION_BUDGET_ERROR) {
    return "inspection-budget";
  }
  if (error.message === REVIEWED_JSON_NON_JSON_ERROR) {
    return "non-json";
  }

  return "unexpected";
}

function classifyMappedContractFailure(error: unknown): VerificationReason {
  if (error instanceof PancakeCatalogContractError) {
    return error.reason;
  }

  return "mapped-contract";
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof PancakeContractVerificationStageError) {
    return (
      `Pancake reviewed-contract verification failed ` +
      `[stage=${error.stage} reason=${error.reason}] ` +
      "without logging external values or unknown field names"
    );
  }

  return "Pancake reviewed-contract verification failed without logging external values or unknown field names";
}

async function main() {
  let config: ReturnType<typeof readPancakeConfig>;
  try {
    assertReviewedPancakeContractKeysConfigured();
    config = readPancakeConfig();
  } catch {
    throw new PancakeContractVerificationStageError("configuration", "configuration");
  }

  const client = new PancakeClient({ apiKey: config.apiKey });

  let productVariations: unknown;
  try {
    productVariations = await client.getJson(`/shops/${config.shopId}/products/variations`);
  } catch {
    throw new PancakeContractVerificationStageError("product-fetch", "transport");
  }

  let warehouses: unknown;
  try {
    warehouses = await client.getJson(`/shops/${config.shopId}/warehouses`);
  } catch {
    throw new PancakeContractVerificationStageError("warehouse-fetch", "transport");
  }

  let productVariationShape: ReturnType<typeof describeReviewedJsonShape>;
  try {
    productVariationShape = describeReviewedJsonShape(
      productVariations,
      verificationOptions(REVIEWED_PANCAKE_CONTRACT_KEYS.productVariations),
    );
  } catch (error) {
    throw new PancakeContractVerificationStageError(
      "product-key-contract",
      classifyReviewedJsonFailure(error),
    );
  }

  let warehouseShape: ReturnType<typeof describeReviewedJsonShape>;
  try {
    warehouseShape = describeReviewedJsonShape(
      warehouses,
      verificationOptions(REVIEWED_PANCAKE_CONTRACT_KEYS.warehouses),
    );
  } catch (error) {
    throw new PancakeContractVerificationStageError(
      "warehouse-key-contract",
      classifyReviewedJsonFailure(error),
    );
  }

  // The allowlist validates every returned object key. These parsers separately validate
  // the exact path/type subset that C4 is allowed to consume, including pagination and
  // all-warehouse remain_quantity aggregation. Parsed values are deliberately discarded.
  try {
    parsePancakeCatalogVariations(productVariations);
  } catch (error) {
    throw new PancakeContractVerificationStageError(
      "product-mapped-contract",
      classifyMappedContractFailure(error),
    );
  }

  try {
    parsePancakeWarehouses(warehouses);
  } catch (error) {
    throw new PancakeContractVerificationStageError(
      "warehouse-mapped-contract",
      classifyMappedContractFailure(error),
    );
  }

  const contractShapes = {
    productVariations: productVariationShape,
    warehouses: warehouseShape,
  };

  console.log("PANCAKE_REVIEWED_CONTRACT_VERIFICATION_BEGIN");
  console.log(JSON.stringify(contractShapes, null, 2));
  console.log("PANCAKE_REVIEWED_CONTRACT_VERIFICATION_END");
}

try {
  await main();
} catch (error) {
  console.error(safeFailureMessage(error));
  process.exitCode = 1;
}
