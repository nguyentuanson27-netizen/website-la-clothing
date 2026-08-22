type JsonRecord = Record<string, unknown>;

type ParsedCompositeEdge = {
  edgeId: string;
  parentVariationId: string;
  componentVariationId: string;
  componentProductId: string;
  quantity: number;
};

export type PancakeCompositeEdge = Readonly<{
  parentVariationId: string;
  componentVariationId: string;
  quantity: number;
}>;

export type PancakeCompositeSnapshot = Readonly<{
  parentVariationIds: readonly string[];
  componentVariationIds: readonly string[];
  edges: readonly PancakeCompositeEdge[];
}>;

const CONTRACT_ERROR = "Pancake composite contract is malformed";
const MAX_ID_LENGTH = 512;
const MAX_COMPOSITE_ENTRIES = 50_000;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

function fail(): never {
  throw new TypeError(CONTRACT_ERROR);
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) fail();
  return value;
}

function requireIdentity(record: JsonRecord, key: string): string {
  const value = record[key];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    value.trim() !== value
  ) {
    fail();
  }
  return value;
}

function requirePositiveInteger(value: unknown, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximum
  ) {
    fail();
  }
  return value;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareEdges(left: PancakeCompositeEdge, right: PancakeCompositeEdge): number {
  return (
    compareStrings(left.parentVariationId, right.parentVariationId) ||
    compareStrings(left.componentVariationId, right.componentVariationId)
  );
}

export function parsePancakeCompositeSnapshot({
  shopId,
  parentEntries,
  childEntries,
}: {
  shopId: number;
  parentEntries: readonly unknown[];
  childEntries: readonly unknown[];
}): PancakeCompositeSnapshot {
  const safeShopId = requirePositiveInteger(shopId, MAX_POSTGRES_INTEGER);
  if (
    parentEntries.length > MAX_COMPOSITE_ENTRIES ||
    childEntries.length > MAX_COMPOSITE_ENTRIES
  ) {
    fail();
  }

  const parentVariationIds = new Set<string>();
  const childProductByVariationId = new Map<string, string>();
  const edgeIds = new Set<string>();
  const edgePairs = new Set<string>();
  const parsedEdges: ParsedCompositeEdge[] = [];

  for (const entryValue of parentEntries) {
    const entry = requireRecord(entryValue);
    const parentVariationId = requireIdentity(entry, "id");
    requireIdentity(entry, "product_id");
    if (entry.is_composite !== true || !Array.isArray(entry.composite_products)) fail();
    if (parentVariationIds.has(parentVariationId)) fail();
    parentVariationIds.add(parentVariationId);

    if (entry.composite_products.length === 0) fail();
    if (parsedEdges.length + entry.composite_products.length > MAX_COMPOSITE_ENTRIES) fail();

    for (const edgeValue of entry.composite_products) {
      const edge = requireRecord(edgeValue);
      const edgeId = requireIdentity(edge, "id");
      const edgeParentVariationId = requireIdentity(edge, "variation_id");
      const componentVariationId = requireIdentity(edge, "component_id");
      const quantity = requirePositiveInteger(edge.quantity, MAX_POSTGRES_INTEGER);
      const edgeShopId = requirePositiveInteger(edge.shop_id, MAX_POSTGRES_INTEGER);
      const component = requireRecord(edge.component);
      const nestedComponentId = requireIdentity(component, "id");
      const componentProductId = requireIdentity(component, "product_id");

      if (
        edgeIds.has(edgeId) ||
        edgeParentVariationId !== parentVariationId ||
        edgeShopId !== safeShopId ||
        nestedComponentId !== componentVariationId ||
        component.is_composite !== false ||
        componentVariationId === parentVariationId
      ) {
        fail();
      }
      edgeIds.add(edgeId);

      const pairKey = `${parentVariationId}\u0000${componentVariationId}`;
      if (edgePairs.has(pairKey)) fail();
      edgePairs.add(pairKey);

      parsedEdges.push({
        edgeId,
        parentVariationId,
        componentVariationId,
        componentProductId,
        quantity,
      });
    }
  }

  for (const entryValue of childEntries) {
    const entry = requireRecord(entryValue);
    const componentVariationId = requireIdentity(entry, "id");
    const componentProductId = requireIdentity(entry, "product_id");
    if (
      entry.is_composite !== false ||
      !Array.isArray(entry.composite_products) ||
      entry.composite_products.length !== 0 ||
      childProductByVariationId.has(componentVariationId) ||
      parentVariationIds.has(componentVariationId)
    ) {
      fail();
    }
    childProductByVariationId.set(componentVariationId, componentProductId);
  }

  for (const edge of parsedEdges) {
    if (childProductByVariationId.get(edge.componentVariationId) !== edge.componentProductId) {
      fail();
    }
  }

  return {
    parentVariationIds: [...parentVariationIds].sort(compareStrings),
    componentVariationIds: [...childProductByVariationId.keys()].sort(compareStrings),
    edges: parsedEdges
      .map(({ parentVariationId, componentVariationId, quantity }) => ({
        parentVariationId,
        componentVariationId,
        quantity,
      }))
      .sort(compareEdges),
  };
}
