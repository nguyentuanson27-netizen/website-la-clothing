import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  inspectPancakeGeoOpenApi,
  PancakeOrderOpenApiError,
  type PancakeGeoOpenApiInspection,
} from "../src/integrations/pancake/order-openapi-contract.ts";

const MAX_EVIDENCE_FILE_BYTES = 16 * 1024 * 1024;
const FILE_REQUIRED = "OPENAPI_EVIDENCE_FILE_REQUIRED";
const FILE_UNREADABLE = "OPENAPI_EVIDENCE_FILE_UNREADABLE";
const FILE_TOO_LARGE = "OPENAPI_EVIDENCE_FILE_TOO_LARGE";
const GENERIC_FAILURE = "OPENAPI_EVIDENCE_INSPECTION_FAILED";
const SAFE_LOCAL_FAILURES = new Set([FILE_REQUIRED, FILE_UNREADABLE, FILE_TOO_LARGE]);

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

type PancakeGeoEvidenceEnvelope = {
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
  operations: PancakeGeoOpenApiInspection;
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

export function trustedLocalGeoOpenApiFailureMessage(error: unknown): string {
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
    return buffer.subarray(0, totalBytes);
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

function inspectApiKeyAuth(document: JsonRecord): PancakeGeoEvidenceEnvelope["auth"] {
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

function assertGeoOperationsUseRootDeploymentDefaults(
  document: JsonRecord,
  inspection: PancakeGeoOpenApiInspection,
): void {
  if (!isRecord(document.paths)) {
    malformed();
  }

  for (const operation of Object.values(inspection)) {
    const pathItem = document.paths[operation.path];
    if (!isRecord(pathItem)) {
      malformed();
    }

    // The structural inspector may resolve local Path Item refs, but the evidence
    // envelope intentionally derives deployment/auth metadata only from root-level
    // declarations. A path indirection or override therefore fails closed.
    if (
      Object.hasOwn(pathItem, "$ref") ||
      Object.hasOwn(pathItem, "servers") ||
      Object.hasOwn(pathItem, "security")
    ) {
      malformed();
    }

    const get = pathItem.get;
    if (!isRecord(get)) {
      malformed();
    }
    if (Object.hasOwn(get, "security") || Object.hasOwn(get, "servers")) {
      malformed();
    }
  }
}

function buildEvidenceEnvelope(source: Buffer, document: unknown): PancakeGeoEvidenceEnvelope {
  if (!isRecord(document)) {
    malformed();
  }

  const inspection = inspectPancakeGeoOpenApi(document);
  assertGeoOperationsUseRootDeploymentDefaults(document, inspection);

  return {
    source: inspectSourceMetadata(document, source),
    auth: inspectApiKeyAuth(document),
    operations: inspection,
  };
}

export async function inspectTrustedLocalPancakeGeoOpenApi(
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
      await inspectTrustedLocalPancakeGeoOpenApi(args[0]);
    } catch (error) {
      console.error(trustedLocalGeoOpenApiFailureMessage(error));
      process.exitCode = 1;
    }
  }
}
