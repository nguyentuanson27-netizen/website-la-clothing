type JsonRecord = Record<string, unknown>;

export type PancakeCatalogField = {
  id: string;
  keyValue: string;
  name: string;
  value: string;
};

export type PancakeCatalogWarehouseStock = {
  warehouseId: string;
  remainQuantity: number;
};

export type PancakeCatalogVariation = {
  id: string;
  productId: string;
  displayId: string;
  barcode: string;
  fields: PancakeCatalogField[];
  imageUrls: string[];
  isHidden: boolean;
  isLocked: boolean;
  retailPrice: number;
  retailPriceAfterDiscount: number;
  product: {
    id: string;
    name: string;
  };
  warehouseStocks: PancakeCatalogWarehouseStock[];
  sellableStock: number;
};

export type PancakeCatalogPage = {
  pageNumber: number;
  pageSize: number;
  totalEntries: number;
  totalPages: number;
  variations: PancakeCatalogVariation[];
};

export type PancakeWarehouse = {
  id: string;
  name: string;
  allowCreateOrder: boolean;
};

export class PancakeCatalogContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PancakeCatalogContractError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, message: string): JsonRecord {
  if (!isRecord(value)) {
    throw new PancakeCatalogContractError(message);
  }
  return value;
}

function requireString(record: JsonRecord, key: string, message: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new PancakeCatalogContractError(message);
  }
  return value;
}

function requireNonEmptyString(record: JsonRecord, key: string, message: string): string {
  const value = requireString(record, key, message);
  if (value.length === 0) {
    throw new PancakeCatalogContractError(message);
  }
  return value;
}

function requireBoolean(record: JsonRecord, key: string, message: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new PancakeCatalogContractError(message);
  }
  return value;
}

function requireFiniteNumber(record: JsonRecord, key: string, message: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PancakeCatalogContractError(message);
  }
  return value;
}

function requireNonNegativeSafeInteger(record: JsonRecord, key: string, message: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new PancakeCatalogContractError(message);
  }
  return value;
}

function requireArray(record: JsonRecord, key: string, message: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new PancakeCatalogContractError(message);
  }
  return value;
}

function addFinite(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isFinite(sum)) {
    throw new PancakeCatalogContractError("Pancake sellable stock total is outside numeric bounds");
  }
  return sum;
}

function parseField(value: unknown): PancakeCatalogField {
  const record = requireRecord(value, "Pancake variation field payload is malformed");
  return {
    id: requireNonEmptyString(record, "id", "Pancake variation field id is malformed"),
    keyValue: requireString(record, "keyValue", "Pancake variation field keyValue is malformed"),
    name: requireString(record, "name", "Pancake variation field name is malformed"),
    value: requireString(record, "value", "Pancake variation field value is malformed"),
  };
}

function parseImageUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new PancakeCatalogContractError("Pancake variation image payload is malformed");
  }
  return value;
}

function parseWarehouseStock(value: unknown): PancakeCatalogWarehouseStock {
  const record = requireRecord(value, "Pancake variation warehouse payload is malformed");
  return {
    warehouseId: requireNonEmptyString(
      record,
      "warehouse_id",
      "Pancake variation warehouse id is malformed",
    ),
    remainQuantity: requireFiniteNumber(
      record,
      "remain_quantity",
      "Pancake variation remain_quantity is malformed",
    ),
  };
}

function parseVariation(value: unknown): PancakeCatalogVariation {
  const record = requireRecord(value, "Pancake product-variation item is malformed");
  const id = requireNonEmptyString(record, "id", "Pancake variation id is malformed");
  const productId = requireNonEmptyString(
    record,
    "product_id",
    "Pancake variation product_id is malformed",
  );

  const productRecord = requireRecord(record.product, "Pancake variation product payload is malformed");
  const nestedProductId = requireNonEmptyString(
    productRecord,
    "id",
    "Pancake product id is malformed",
  );
  if (nestedProductId !== productId) {
    throw new PancakeCatalogContractError("Pancake variation product identity is inconsistent");
  }

  const warehouseStocks = requireArray(
    record,
    "variations_warehouses",
    "Pancake variation warehouses payload is malformed",
  ).map(parseWarehouseStock);
  const seenWarehouseIds = new Set<string>();
  let sellableStock = 0;

  for (const warehouseStock of warehouseStocks) {
    if (seenWarehouseIds.has(warehouseStock.warehouseId)) {
      throw new PancakeCatalogContractError(
        "Pancake catalog contract cannot aggregate duplicate warehouse_id rows safely",
      );
    }
    seenWarehouseIds.add(warehouseStock.warehouseId);
    sellableStock = addFinite(sellableStock, warehouseStock.remainQuantity);
  }

  return {
    id,
    productId,
    displayId: requireString(record, "display_id", "Pancake variation display_id is malformed"),
    barcode: requireString(record, "barcode", "Pancake variation barcode is malformed"),
    fields: requireArray(record, "fields", "Pancake variation fields payload is malformed").map(
      parseField,
    ),
    imageUrls: requireArray(record, "images", "Pancake variation images payload is malformed").map(
      parseImageUrl,
    ),
    isHidden: requireBoolean(record, "is_hidden", "Pancake variation is_hidden is malformed"),
    isLocked: requireBoolean(record, "is_locked", "Pancake variation is_locked is malformed"),
    retailPrice: requireFiniteNumber(record, "retail_price", "Pancake variation retail_price is malformed"),
    retailPriceAfterDiscount: requireFiniteNumber(
      record,
      "retail_price_after_discount",
      "Pancake variation retail_price_after_discount is malformed",
    ),
    product: {
      id: nestedProductId,
      name: requireString(productRecord, "name", "Pancake product name is malformed"),
    },
    warehouseStocks,
    sellableStock,
  };
}

export function parsePancakeCatalogVariations(payload: unknown): PancakeCatalogPage {
  const root = requireRecord(payload, "Pancake product-variation payload is malformed");
  if (root.success !== true) {
    throw new PancakeCatalogContractError("Pancake product-variation response is unsuccessful");
  }

  const paginationError = "Pancake catalog pagination payload is malformed";
  return {
    pageNumber: requireNonNegativeSafeInteger(root, "page_number", paginationError),
    pageSize: requireNonNegativeSafeInteger(root, "page_size", paginationError),
    totalEntries: requireNonNegativeSafeInteger(root, "total_entries", paginationError),
    totalPages: requireNonNegativeSafeInteger(root, "total_pages", paginationError),
    variations: requireArray(
      root,
      "data",
      "Pancake product-variation payload is missing data array",
    ).map(parseVariation),
  };
}

export function parsePancakeWarehouses(payload: unknown): PancakeWarehouse[] {
  const root = requireRecord(payload, "Pancake warehouse payload is malformed");
  if (root.success !== true) {
    throw new PancakeCatalogContractError("Pancake warehouse response is unsuccessful");
  }

  const seenIds = new Set<string>();
  return requireArray(root, "data", "Pancake warehouse payload is missing data array").map((value) => {
    const record = requireRecord(value, "Pancake warehouse item is malformed");
    const id = requireNonEmptyString(record, "id", "Pancake warehouse id is malformed");
    if (seenIds.has(id)) {
      throw new PancakeCatalogContractError("Pancake warehouse response contains duplicate ids");
    }
    seenIds.add(id);

    return {
      id,
      name: requireString(record, "name", "Pancake warehouse name is malformed"),
      allowCreateOrder: requireBoolean(
        record,
        "allow_create_order",
        "Pancake warehouse allow_create_order is malformed",
      ),
    };
  });
}
