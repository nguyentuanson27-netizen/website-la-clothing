import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  inspectPancakeCreateOrderOpenApi,
  PancakeOrderOpenApiError,
  type OpenApiSchemaStructure,
  type PancakeCreateOrderOpenApiInspection,
} from "../src/integrations/pancake/order-openapi-contract.ts";

const MAX_EVIDENCE_FILE_BYTES = 16 * 1024 * 1024;
const FILE_REQUIRED = "OPENAPI_EVIDENCE_FILE_REQUIRED";
const FILE_UNREADABLE = "OPENAPI_EVIDENCE_FILE_UNREADABLE";
const FILE_TOO_LARGE = "OPENAPI_EVIDENCE_FILE_TOO_LARGE";
const GENERIC_FAILURE = "OPENAPI_EVIDENCE_INSPECTION_FAILED";
const SAFE_LOCAL_FAILURES = new Set([FILE_REQUIRED, FILE_UNREADABLE, FILE_TOO_LARGE]);

const SELECTED_REQUEST_PROPERTIES = [
  "shop_id",
  "bill_full_name",
  "bill_phone_number",
  "shipping_fee",
  "is_free_shipping",
  "received_at_shop",
  "note",
  "note_print",
  "warehouse_id",
  "custom_id",
  "account",
  "account_name",
  "cod",
  "cash",
  "total_discount",
] as const;
const SELECTED_SHIPPING_PROPERTIES = [
  "full_name",
  "phone_number",
  "address",
  "full_address",
  "province_id",
  "district_id",
  "commune_id",
  "country_code",
] as const;
const SELECTED_RESPONSE_PROPERTIES = [
  "id",
  "shop_id",
  "status",
  "custom_id",
  "bill_full_name",
  "bill_phone_number",
] as const;

type JsonRecord = Record<string, unknown>;
type SafeFileStats = { isFile(): boolean; size: number };
type SafeFileHandle = {
  stat(): Promise<SafeFileStats>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number; buffer: Uint8Array }>;
  close(): Promise<void>;
};
type OpenEvidenceFile = (filePath: string, flags: "r") => Promise<SafeFileHandle>;
type EvidenceDependencies = { openFile?: OpenEvidenceFile };

type ItemsEvidence = {
  type?: string | string[];
  itemRequired: string[];
  variation_id?: string | string[];
  quantity?: string | string[];
  "variation_info.retail_price"?: string | string[];
};

type ShippingEvidence = {
  required: string[];
  properties: Record<string, string | string[]>;
};

type PancakeOrderEvidenceEnvelope = {
  source: {
    sha256: string;
    bytes: number;
    openapi: string;
    title: string;
    version: string;
    server: string;
  };
  auth: {
    type: "apiKey";
    in: "query" | "header" | "cookie";
    name: string;
  };
  operation: {
    path: string;
    method: "POST";
    pathParameters: Array<{
      name: string;
      in: "path";
      required: true;
      type?: string | string[];
    }>;
    requestBody?: {
      required: boolean;
      contentType?: string;
      topLevelRequired: string[];
      selectedProperties: Record<string, string | string[]>;
      items?: ItemsEvidence;
      shippingAddress?: ShippingEvidence;
    };
    response: {
      statuses: string[];
      contentType?: string;
      required: string[];
      identity: Record<string, string | string[]>;
      selectedProperties: Record<string, string | string[]>;
    };
  };
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(): never {
  throw new PancakeOrderOpenApiError("MALFORMED_OPENAPI_DOCUMENT");
}

function isSafeLocalFailure(error: unknown): error is Error {
  return error instanceof Error && SAFE_LOCAL_FAILURES.has(error.message);
}

export function trustedLocalOpenApiFailureMessage(error: unknown): string {
  if (error instanceof PancakeOrderOpenApiError) {
    return error.code;
  }
  if (isSafeLocalFailure(error)) {
    return error.message;
  }
  return GENERIC_FAILURE;
}

async function readBoundedEvidenceFile(
  filePath: string,
  openFile: OpenEvidenceFile,
): Promise<Buffer> {
  let handle: SafeFileHandle;
  try {
    handle = await openFile(filePath, "r");
  } catch {
    throw new Error(FILE_UNREADABLE);
  }

  let failure: unknown;
  try {
    let metadata: SafeFileStats;
    try {
      metadata = await handle.stat();
    } catch {
      throw new Error(FILE_UNREADABLE);
    }
    if (!metadata.isFile()) {
      throw new Error(FILE_UNREADABLE);
    }
    if (metadata.size > MAX_EVIDENCE_FILE_BYTES) {
      throw new Error(FILE_TOO_LARGE);
    }

    const buffer = Buffer.allocUnsafe(MAX_EVIDENCE_FILE_BYTES + 1);
    let totalBytes = 0;
    while (totalBytes < buffer.length) {
      let bytesRead: number;
      try {
        ({ bytesRead } = await handle.read(
          buffer,
          totalBytes,
          buffer.length - totalBytes,
          totalBytes,
        ));
      } catch {
        throw new Error(FILE_UNREADABLE);
      }
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > buffer.length - totalBytes) {
        throw new Error(FILE_UNREADABLE);
      }
      if (bytesRead === 0) {
        break;
      }
      totalBytes += bytesRead;
    }

    if (totalBytes > MAX_EVIDENCE_FILE_BYTES) {
      throw new Error(FILE_TOO_LARGE);
    }
    return Buffer.from(buffer.subarray(0, totalBytes));
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await handle.close();
    } catch {
      if (failure === undefined) {
        throw new Error(FILE_UNREADABLE);
      }
    }
  }
}

function requireString(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    malformed();
  }
  return value;
}

function inspectSourceMetadata(document: JsonRecord, source: Buffer) {
  const info = document.info;
  const servers = document.servers;
  if (!isRecord(info) || !Array.isArray(servers) || servers.length !== 1 || !isRecord(servers[0])) {
    malformed();
  }

  return {
    sha256: createHash("sha256").update(source).digest("hex"),
    bytes: source.length,
    openapi: requireString(document, "openapi"),
    title: requireString(info, "title"),
    version: requireString(info, "version"),
    server: requireString(servers[0], "url"),
  };
}

function inspectApiKeyAuth(document: JsonRecord): PancakeOrderEvidenceEnvelope["auth"] {
  if (!Array.isArray(document.security) || document.security.length !== 1) {
    malformed();
  }
  const requirement = document.security[0];
  if (!isRecord(requirement)) {
    malformed();
  }
  const names = Object.keys(requirement);
  if (names.length !== 1 || !Array.isArray(requirement[names[0]])) {
    malformed();
  }

  const components = document.components;
  if (!isRecord(components) || !isRecord(components.securitySchemes)) {
    malformed();
  }
  const scheme = components.securitySchemes[names[0]];
  if (!isRecord(scheme) || scheme.type !== "apiKey") {
    malformed();
  }
  const location = scheme.in;
  if (location !== "query" && location !== "header" && location !== "cookie") {
    malformed();
  }
  return {
    type: "apiKey",
    in: location,
    name: requireString(scheme, "name"),
  };
}

function schemaType(schema: OpenApiSchemaStructure | undefined): string | string[] | undefined {
  return schema?.type;
}

function selectedPropertyTypes(
  properties: Record<string, OpenApiSchemaStructure> | undefined,
  names: readonly string[],
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  if (properties === undefined) {
    return result;
  }
  for (const name of names) {
    const type = schemaType(properties[name]);
    if (type !== undefined) {
      result[name] = type;
    }
  }
  return result;
}

function selectContentSchema(
  content: Record<string, OpenApiSchemaStructure> | undefined,
): { contentType?: string; schema?: OpenApiSchemaStructure } {
  if (content === undefined) {
    return {};
  }
  if (Object.hasOwn(content, "application/json")) {
    return { contentType: "application/json", schema: content["application/json"] };
  }
  const contentTypes = Object.keys(content).sort();
  if (contentTypes.length === 0) {
    return {};
  }
  const contentType = contentTypes[0];
  return { contentType, schema: content[contentType] };
}

function inspectItemsEvidence(
  properties: Record<string, OpenApiSchemaStructure> | undefined,
): ItemsEvidence | undefined {
  const items = properties?.items;
  if (items === undefined) {
    return undefined;
  }
  const itemSchema = items.items;
  const itemProperties = itemSchema?.properties;
  const retailPrice = itemProperties?.variation_info?.properties?.retail_price;
  const result: ItemsEvidence = {
    itemRequired: itemSchema?.required ?? [],
  };
  const itemsType = schemaType(items);
  if (itemsType !== undefined) result.type = itemsType;
  const variationIdType = schemaType(itemProperties?.variation_id);
  if (variationIdType !== undefined) result.variation_id = variationIdType;
  const quantityType = schemaType(itemProperties?.quantity);
  if (quantityType !== undefined) result.quantity = quantityType;
  const retailPriceType = schemaType(retailPrice);
  if (retailPriceType !== undefined) result["variation_info.retail_price"] = retailPriceType;
  return result;
}

function inspectShippingEvidence(
  properties: Record<string, OpenApiSchemaStructure> | undefined,
): ShippingEvidence | undefined {
  const shipping = properties?.shipping_address;
  if (shipping === undefined) {
    return undefined;
  }
  return {
    required: shipping.required ?? [],
    properties: selectedPropertyTypes(shipping.properties, SELECTED_SHIPPING_PROPERTIES),
  };
}

function inspectOperationEvidence(
  inspection: PancakeCreateOrderOpenApiInspection,
): PancakeOrderEvidenceEnvelope["operation"] {
  const pathParameters = inspection.parameters
    .filter((parameter) => parameter.in === "path" && parameter.required)
    .map((parameter) => {
      const type = schemaType(parameter.schema);
      return {
        name: parameter.name,
        in: "path" as const,
        required: true as const,
        ...(type === undefined ? {} : { type }),
      };
    });

  let requestBody: PancakeOrderEvidenceEnvelope["operation"]["requestBody"];
  if (inspection.requestBody !== undefined) {
    const selected = selectContentSchema(inspection.requestBody.content);
    const properties = selected.schema?.properties;
    const items = inspectItemsEvidence(properties);
    const shippingAddress = inspectShippingEvidence(properties);
    requestBody = {
      required: inspection.requestBody.required,
      ...(selected.contentType === undefined ? {} : { contentType: selected.contentType }),
      topLevelRequired: selected.schema?.required ?? [],
      selectedProperties: selectedPropertyTypes(properties, SELECTED_REQUEST_PROPERTIES),
      ...(items === undefined ? {} : { items }),
      ...(shippingAddress === undefined ? {} : { shippingAddress }),
    };
  }

  const statuses = Object.keys(inspection.responses).sort();
  const preferredResponse = inspection.responses["200"] ?? inspection.responses[statuses[0]];
  const responseContent = selectContentSchema(preferredResponse?.content);
  const responseProperties = responseContent.schema?.properties;
  const idType = schemaType(responseProperties?.id);

  return {
    path: inspection.path,
    method: inspection.method,
    pathParameters,
    ...(requestBody === undefined ? {} : { requestBody }),
    response: {
      statuses,
      ...(responseContent.contentType === undefined ? {} : { contentType: responseContent.contentType }),
      required: responseContent.schema?.required ?? [],
      identity: idType === undefined ? {} : { id: idType },
      selectedProperties: selectedPropertyTypes(responseProperties, SELECTED_RESPONSE_PROPERTIES),
    },
  };
}

function buildEvidenceEnvelope(source: Buffer, document: unknown): PancakeOrderEvidenceEnvelope {
  if (!isRecord(document)) {
    malformed();
  }
  const inspection = inspectPancakeCreateOrderOpenApi(document);
  return {
    source: inspectSourceMetadata(document, source),
    auth: inspectApiKeyAuth(document),
    operation: inspectOperationEvidence(inspection),
  };
}

export async function inspectTrustedLocalPancakeOrderOpenApi(
  filePath: string,
  { openFile = open as OpenEvidenceFile }: EvidenceDependencies = {},
): Promise<void> {
  const source = await readBoundedEvidenceFile(filePath, openFile);

  let document: unknown;
  try {
    document = JSON.parse(source.toString("utf8"));
  } catch {
    throw new PancakeOrderOpenApiError("MALFORMED_OPENAPI_DOCUMENT");
  }

  console.log(JSON.stringify(buildEvidenceEnvelope(source, document), null, 2));
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectExecution()) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].trim() === "") {
    console.error(FILE_REQUIRED);
    process.exitCode = 1;
  } else {
    try {
      await inspectTrustedLocalPancakeOrderOpenApi(args[0]);
    } catch (error) {
      console.error(trustedLocalOpenApiFailureMessage(error));
      process.exitCode = 1;
    }
  }
}
