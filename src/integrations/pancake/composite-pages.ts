import {
  parsePancakeCompositeSnapshot,
  type PancakeCompositeSnapshot,
} from "./composite-contract.ts";

type QueryValue = string | number | boolean;
type CompositeClient = {
  getJson(endpoint: string, query?: Readonly<Record<string, QueryValue>>): Promise<unknown>;
};
type CompositeRole = "parent" | "children";
type JsonRecord = Record<string, unknown>;

type ParsedPage = {
  data: unknown[];
  totalEntries: number;
  totalPages: number;
};

const PAGE_SIZE = 100;
const MAX_COMPOSITE_PAGES = 500;
const MAX_COMPOSITE_ENTRIES = 50_000;
const PAGINATION_ERROR = "Pancake composite pagination payload is malformed";

function fail(): never {
  throw new TypeError(PAGINATION_ERROR);
}

function requireRecord(value: unknown): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  return value as JsonRecord;
}

function requireNonNegativeSafeInteger(record: JsonRecord, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function parsePage({
  payload,
  expectedPageNumber,
  expectedTotalEntries,
  expectedTotalPages,
}: {
  payload: unknown;
  expectedPageNumber: number;
  expectedTotalEntries?: number;
  expectedTotalPages?: number;
}): ParsedPage {
  const root = requireRecord(payload);
  if (root.success !== true || !Array.isArray(root.data)) fail();

  const pageNumber = requireNonNegativeSafeInteger(root, "page_number");
  const pageSize = requireNonNegativeSafeInteger(root, "page_size");
  const totalEntries = requireNonNegativeSafeInteger(root, "total_entries");
  const totalPages = requireNonNegativeSafeInteger(root, "total_pages");
  const computedTotalPages = totalEntries === 0 ? totalPages : Math.ceil(totalEntries / PAGE_SIZE);
  const emptyPaginationValid = totalEntries !== 0 || totalPages === 0 || totalPages === 1;
  const expectedRows =
    totalEntries === 0
      ? 0
      : Math.min(PAGE_SIZE, Math.max(0, totalEntries - (expectedPageNumber - 1) * PAGE_SIZE));

  if (
    pageNumber !== expectedPageNumber ||
    pageSize !== PAGE_SIZE ||
    totalEntries > MAX_COMPOSITE_ENTRIES ||
    totalPages > MAX_COMPOSITE_PAGES ||
    !emptyPaginationValid ||
    (totalEntries > 0 && totalPages !== computedTotalPages) ||
    root.data.length !== expectedRows ||
    (expectedTotalEntries !== undefined && totalEntries !== expectedTotalEntries) ||
    (expectedTotalPages !== undefined && totalPages !== expectedTotalPages)
  ) {
    fail();
  }

  return { data: root.data, totalEntries, totalPages };
}

async function fetchRoleEntries({
  client,
  endpoint,
  role,
}: {
  client: CompositeClient;
  endpoint: string;
  role: CompositeRole;
}): Promise<unknown[]> {
  const first = parsePage({
    payload: await client.getJson(endpoint, {
      page_number: 1,
      page_size: PAGE_SIZE,
      included_composite: role,
    }),
    expectedPageNumber: 1,
  });
  const entries = [...first.data];
  const traversedPages = Math.max(1, first.totalPages);

  for (let pageNumber = 2; pageNumber <= traversedPages; pageNumber += 1) {
    const page = parsePage({
      payload: await client.getJson(endpoint, {
        page_number: pageNumber,
        page_size: PAGE_SIZE,
        included_composite: role,
      }),
      expectedPageNumber: pageNumber,
      expectedTotalEntries: first.totalEntries,
      expectedTotalPages: first.totalPages,
    });
    entries.push(...page.data);
  }

  if (entries.length !== first.totalEntries) fail();
  return entries;
}

export async function fetchPancakeCompositeSnapshot({
  client,
  shopId,
}: {
  client: CompositeClient;
  shopId: number;
}): Promise<PancakeCompositeSnapshot> {
  if (!Number.isSafeInteger(shopId) || shopId <= 0) fail();

  const endpoint = `/shops/${shopId}/products/variations`;
  const parentEntries = await fetchRoleEntries({ client, endpoint, role: "parent" });
  const childEntries = await fetchRoleEntries({ client, endpoint, role: "children" });

  return parsePancakeCompositeSnapshot({ shopId, parentEntries, childEntries });
}
