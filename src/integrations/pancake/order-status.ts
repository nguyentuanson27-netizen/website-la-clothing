type JsonRecord = Record<string, unknown>;

export const PANCAKE_ORDER_STATUS_CODES = [
  0, 17, 11, 12, 13, 20, 1, 8, 9, 2, 3, 16, 4, 15, 5, 6, 7,
] as const;

export type PancakeOrderStatusCode = (typeof PANCAKE_ORDER_STATUS_CODES)[number];

export type PancakeOrderStatus = Readonly<{
  orderId: string;
  systemId: number;
  shopId: number;
  status: PancakeOrderStatusCode;
  insertedAt: string;
  updatedAt: string;
}>;

export class PancakeOrderStatusContractError extends Error {
  constructor() {
    super("Pancake order-status response is invalid");
    this.name = "PancakeOrderStatusContractError";
  }
}

const STATUS_CODES = new Set<number>(PANCAKE_ORDER_STATUS_CODES);
const RFC3339_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function invalidContract(): never {
  throw new PancakeOrderStatusContractError();
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isCanonicalPancakeOrderId(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    return false;
  }

  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 && String(numeric) === value;
}

function requireExpectedShopId(value: unknown): number {
  if (!isPositiveSafeInteger(value)) invalidContract();
  return value;
}

function requireExpectedOrderId(value: unknown): string {
  if (!isCanonicalPancakeOrderId(value)) invalidContract();
  return value;
}

function requirePositiveSafeInteger(value: unknown): number {
  if (!isPositiveSafeInteger(value)) invalidContract();
  return value;
}

function requireStatusCode(value: unknown): PancakeOrderStatusCode {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || !STATUS_CODES.has(value)) {
    invalidContract();
  }
  return value as PancakeOrderStatusCode;
}

function requireDateTime(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 64 ||
    value.trim() !== value ||
    !RFC3339_DATE_TIME.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    invalidContract();
  }
  return value;
}

export function parsePancakeOrderStatusResponse(
  payload: unknown,
  expected: Readonly<{ shopId: number; orderId: string }>,
): PancakeOrderStatus {
  if (!expected || typeof expected !== "object") invalidContract();
  const expectedShopId = requireExpectedShopId(expected.shopId);
  const expectedOrderId = requireExpectedOrderId(expected.orderId);

  if (!isRecord(payload)) invalidContract();

  const orderId = requirePositiveSafeInteger(payload.id);
  const systemId = requirePositiveSafeInteger(payload.system_id);
  const shopId = requirePositiveSafeInteger(payload.shop_id);
  const status = requireStatusCode(payload.status);
  const insertedAt = requireDateTime(payload.inserted_at);
  const updatedAt = requireDateTime(payload.updated_at);

  if (String(orderId) !== expectedOrderId || shopId !== expectedShopId) {
    invalidContract();
  }

  return {
    orderId: expectedOrderId,
    systemId,
    shopId,
    status,
    insertedAt,
    updatedAt,
  };
}
