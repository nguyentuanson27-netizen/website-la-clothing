const STOCK_QUANTITY_FIELDS = [
  "actual_remain_quantity",
  "remain_quantity",
  "total_quantity",
  "pending_quantity",
  "waiting_quantity",
  "returning_quantity",
] as const;

type StockQuantityField = (typeof STOCK_QUANTITY_FIELDS)[number];

type JsonRecord = Record<string, unknown>;

export type PancakeWarehouseStockProbe = {
  warehouse_id: string;
} & Record<StockQuantityField, number>;

export type PancakeStockProbe = {
  variation: {
    id: string;
    display_id: string | null;
    barcode: string | null;
  };
  warehouses: PancakeWarehouseStockProbe[];
  totals: Record<StockQuantityField, number>;
};

export class PancakeStockProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PancakeStockProbeError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, message: string): JsonRecord {
  if (!isRecord(value)) {
    throw new PancakeStockProbeError(message);
  }
  return value;
}

function optionalIdentityString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new PancakeStockProbeError("Pancake variation identity payload is malformed");
  }
  return value;
}

function requireFiniteNumber(record: JsonRecord, key: StockQuantityField): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PancakeStockProbeError("Pancake warehouse stock quantity payload is malformed");
  }
  return value;
}

function addFinite(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isFinite(sum)) {
    throw new PancakeStockProbeError("Pancake warehouse stock total is outside numeric bounds");
  }
  return sum;
}

function parseWarehouseStock(value: unknown): PancakeWarehouseStockProbe {
  const record = requireRecord(value, "Pancake warehouse stock payload is malformed");
  const warehouseId = record.warehouse_id;
  if (typeof warehouseId !== "string" || warehouseId.length === 0) {
    throw new PancakeStockProbeError("Pancake warehouse stock payload is missing warehouse_id");
  }

  return {
    warehouse_id: warehouseId,
    actual_remain_quantity: requireFiniteNumber(record, "actual_remain_quantity"),
    remain_quantity: requireFiniteNumber(record, "remain_quantity"),
    total_quantity: requireFiniteNumber(record, "total_quantity"),
    pending_quantity: requireFiniteNumber(record, "pending_quantity"),
    waiting_quantity: requireFiniteNumber(record, "waiting_quantity"),
    returning_quantity: requireFiniteNumber(record, "returning_quantity"),
  };
}

function zeroTotals(): Record<StockQuantityField, number> {
  return {
    actual_remain_quantity: 0,
    remain_quantity: 0,
    total_quantity: 0,
    pending_quantity: 0,
    waiting_quantity: 0,
    returning_quantity: 0,
  };
}

export function buildPancakeStockProbe(payload: unknown, selectorInput: string): PancakeStockProbe {
  const selector = selectorInput.trim();
  if (!selector) {
    throw new PancakeStockProbeError("Stock probe selector must not be blank");
  }

  const root = requireRecord(payload, "Pancake product-variation payload is malformed");
  if (!Array.isArray(root.data)) {
    throw new PancakeStockProbeError("Pancake product-variation payload is missing data array");
  }

  const matches: Array<{
    record: JsonRecord;
    id: string | null;
    displayId: string | null;
    barcode: string | null;
  }> = [];

  for (const item of root.data) {
    const record = requireRecord(item, "Pancake product-variation item is malformed");
    const id = optionalIdentityString(record, "id");
    const displayId = optionalIdentityString(record, "display_id");
    const barcode = optionalIdentityString(record, "barcode");

    if (id === selector || displayId === selector || barcode === selector) {
      matches.push({ record, id, displayId, barcode });
    }
  }

  if (matches.length !== 1) {
    throw new PancakeStockProbeError(
      "Stock probe selector must resolve exactly one variation in the fetched Pancake response",
    );
  }

  const match = matches[0];
  if (!match || match.id === null || match.id.length === 0) {
    throw new PancakeStockProbeError("Matched Pancake variation is missing id");
  }

  if (!Array.isArray(match.record.variations_warehouses)) {
    throw new PancakeStockProbeError("Matched Pancake variation is missing variations_warehouses");
  }

  const warehouses = match.record.variations_warehouses.map(parseWarehouseStock);
  const totals = zeroTotals();

  for (const warehouse of warehouses) {
    for (const field of STOCK_QUANTITY_FIELDS) {
      totals[field] = addFinite(totals[field], warehouse[field]);
    }
  }

  return {
    variation: {
      id: match.id,
      display_id: match.displayId,
      barcode: match.barcode,
    },
    warehouses,
    totals,
  };
}
