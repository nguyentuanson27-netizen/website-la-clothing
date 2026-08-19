type JsonRecord = Record<string, unknown>;

export type PancakeCatalogContractReason =
  | "product-envelope"
  | "pagination"
  | "variation-identity"
  | "variation-fields"
  | "variation-images"
  | "variation-flags"
  | "variation-prices"
  | "variation-product-shape"
  | "variation-product-name"
  | "variation-product-description"
  | "variation-product-image"
  | "variation-warehouse"
  | "warehouse-envelope"
  | "warehouse-item";

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
    sourceDescription?: string | null;
    primaryImageUrl?: string | null;
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
  readonly reason: PancakeCatalogContractReason;

  constructor(reason: PancakeCatalogContractReason, message: string) {
    super(message);
    this.name = "PancakeCatalogContractError";
    this.reason = reason;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(
  value: unknown,
  reason: PancakeCatalogContractReason,
  message: string,
): JsonRecord {
  if (!isRecord(value)) {
    throw new PancakeCatalogContractError(reason, message);
  }
  return value;
}

function requireString(
  record: JsonRecord,
  key: string,
  reason: PancakeCatalogContractReason,
  message: string,
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new PancakeCatalogContractError(reason, message);
  }
  return value;
}

function requireOptionalNonBlankString(
  record: JsonRecord,
  key: string,
  reason: PancakeCatalogContractReason,
  message: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new PancakeCatalogContractError(reason, message);
  }
  return value.trim().length === 0 ? null : value;
}

function requireNonEmptyString(
  record: JsonRecord,
  key: string,
  reason: PancakeCatalogContractReason,
  message: string,
): string {
  const value = requireString(record, key, reason, message);
  if (value.length === 0) {
    throw new PancakeCatalogContractError(reason, message);
  }
  return value;
}

function requireBoolean(
  record: JsonRecord,
  key: string,
  reason: PancakeCatalogContractReason,
  message: string,
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new PancakeCatalogContractError(reason, message);
  }
  return value;
}

function requireFiniteNumber(
  record: JsonRecord,
  key: string,
  reason: PancakeCatalogContractReason,
  message: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PancakeCatalogContractError(reason, message);
  }
  return value;
}

function requireNonNegativeSafeInteger(
  record: JsonRecord,
  key: string,
  reason: PancakeCatalogContractReason,
  message: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new PancakeCatalogContractError(reason, message);
  }
  return value;
}

function requireArray(
  record: JsonRecord,
  key: string,
  reason: PancakeCatalogContractReason,
  message: string,
): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new PancakeCatalogContractError(reason, message);
  }
  return value;
}

function addFinite(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isFinite(sum)) {
    throw new PancakeCatalogContractError(
      "variation-warehouse",
      "Pancake sellable stock total is outside numeric bounds",
    );
  }
  return sum;
}

function parseField(value: unknown): PancakeCatalogField {
  const reason = "variation-fields" as const;
  const record = requireRecord(value, reason, "Pancake variation field payload is malformed");
  return {
    id: requireNonEmptyString(record, "id", reason, "Pancake variation field id is malformed"),
    keyValue: requireString(record, "keyValue", reason, "Pancake variation field keyValue is malformed"),
    name: requireString(record, "name", reason, "Pancake variation field name is malformed"),
    value: requireString(record, "value", reason, "Pancake variation field value is malformed"),
  };
}

function parseImageUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new PancakeCatalogContractError(
      "variation-images",
      "Pancake variation image payload is malformed",
    );
  }
  return value;
}

function parseWarehouseStock(value: unknown): PancakeCatalogWarehouseStock {
  const reason = "variation-warehouse" as const;
  const record = requireRecord(value, reason, "Pancake variation warehouse payload is malformed");
  return {
    warehouseId: requireNonEmptyString(
      record,
      "warehouse_id",
      reason,
      "Pancake variation warehouse id is malformed",
    ),
    remainQuantity: requireFiniteNumber(
      record,
      "remain_quantity",
      reason,
      "Pancake variation remain_quantity is malformed",
    ),
  };
}

function parseVariation(value: unknown): PancakeCatalogVariation {
  const identityReason = "variation-identity" as const;
  const record = requireRecord(value, identityReason, "Pancake product-variation item is malformed");
  const id = requireNonEmptyString(record, "id", identityReason, "Pancake variation id is malformed");
  const productId = requireNonEmptyString(
    record,
    "product_id",
    identityReason,
    "Pancake variation product_id is malformed",
  );

  const productRecord = requireRecord(
    record.product,
    "variation-product-shape",
    "Pancake variation product payload is malformed",
  );
  const productName = requireString(
    productRecord,
    "name",
    "variation-product-name",
    "Pancake product name is malformed",
  );
  const sourceDescription = requireOptionalNonBlankString(
    productRecord,
    "note_product",
    "variation-product-description",
    "Pancake product note_product is malformed",
  );
  const primaryImageUrl = requireOptionalNonBlankString(
    productRecord,
    "image",
    "variation-product-image",
    "Pancake product image is malformed",
  );

  const warehouseReason = "variation-warehouse" as const;
  const warehouseStocks = requireArray(
    record,
    "variations_warehouses",
    warehouseReason,
    "Pancake variation warehouses payload is malformed",
  ).map(parseWarehouseStock);
  const seenWarehouseIds = new Set<string>();
  let sellableStock = 0;

  for (const warehouseStock of warehouseStocks) {
    if (seenWarehouseIds.has(warehouseStock.warehouseId)) {
      throw new PancakeCatalogContractError(
        warehouseReason,
        "Pancake catalog contract cannot aggregate duplicate warehouse_id rows safely",
      );
    }
    seenWarehouseIds.add(warehouseStock.warehouseId);
    sellableStock = addFinite(sellableStock, warehouseStock.remainQuantity);
  }

  const fieldsReason = "variation-fields" as const;
  const imagesReason = "variation-images" as const;
  const flagsReason = "variation-flags" as const;
  const pricesReason = "variation-prices" as const;

  return {
    id,
    productId,
    displayId: requireString(
      record,
      "display_id",
      identityReason,
      "Pancake variation display_id is malformed",
    ),
    barcode: requireString(
      record,
      "barcode",
      identityReason,
      "Pancake variation barcode is malformed",
    ),
    fields: requireArray(
      record,
      "fields",
      fieldsReason,
      "Pancake variation fields payload is malformed",
    ).map(parseField),
    imageUrls: requireArray(
      record,
      "images",
      imagesReason,
      "Pancake variation images payload is malformed",
    ).map(parseImageUrl),
    isHidden: requireBoolean(
      record,
      "is_hidden",
      flagsReason,
      "Pancake variation is_hidden is malformed",
    ),
    isLocked: requireBoolean(
      record,
      "is_locked",
      flagsReason,
      "Pancake variation is_locked is malformed",
    ),
    retailPrice: requireFiniteNumber(
      record,
      "retail_price",
      pricesReason,
      "Pancake variation retail_price is malformed",
    ),
    retailPriceAfterDiscount: requireFiniteNumber(
      record,
      "retail_price_after_discount",
      pricesReason,
      "Pancake variation retail_price_after_discount is malformed",
    ),
    product: {
      id: productId,
      name: productName,
      sourceDescription,
      primaryImageUrl,
    },
    warehouseStocks,
    sellableStock,
  };
}

export function parsePancakeCatalogVariations(payload: unknown): PancakeCatalogPage {
  const envelopeReason = "product-envelope" as const;
  const root = requireRecord(payload, envelopeReason, "Pancake product-variation payload is malformed");
  if (root.success !== true) {
    throw new PancakeCatalogContractError(
      envelopeReason,
      "Pancake product-variation response is unsuccessful",
    );
  }

  const paginationReason = "pagination" as const;
  const paginationError = "Pancake catalog pagination payload is malformed";
  return {
    pageNumber: requireNonNegativeSafeInteger(root, "page_number", paginationReason, paginationError),
    pageSize: requireNonNegativeSafeInteger(root, "page_size", paginationReason, paginationError),
    totalEntries: requireNonNegativeSafeInteger(root, "total_entries", paginationReason, paginationError),
    totalPages: requireNonNegativeSafeInteger(root, "total_pages", paginationReason, paginationError),
    variations: requireArray(
      root,
      "data",
      envelopeReason,
      "Pancake product-variation payload is missing data array",
    ).map(parseVariation),
  };
}

export function parsePancakeWarehouses(payload: unknown): PancakeWarehouse[] {
  const envelopeReason = "warehouse-envelope" as const;
  const root = requireRecord(payload, envelopeReason, "Pancake warehouse payload is malformed");
  if (root.success !== true) {
    throw new PancakeCatalogContractError(envelopeReason, "Pancake warehouse response is unsuccessful");
  }

  const itemReason = "warehouse-item" as const;
  const seenIds = new Set<string>();
  return requireArray(root, "data", envelopeReason, "Pancake warehouse payload is missing data array").map(
    (value) => {
      const record = requireRecord(value, itemReason, "Pancake warehouse item is malformed");
      const id = requireNonEmptyString(record, "id", itemReason, "Pancake warehouse id is malformed");
      if (seenIds.has(id)) {
        throw new PancakeCatalogContractError(
          itemReason,
          "Pancake warehouse response contains duplicate ids",
        );
      }
      seenIds.add(id);

      return {
        id,
        name: requireString(record, "name", itemReason, "Pancake warehouse name is malformed"),
        allowCreateOrder: requireBoolean(
          record,
          "allow_create_order",
          itemReason,
          "Pancake warehouse allow_create_order is malformed",
        ),
      };
    },
  );
}
