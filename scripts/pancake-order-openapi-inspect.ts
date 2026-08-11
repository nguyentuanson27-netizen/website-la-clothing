import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  inspectPancakeCreateOrderOpenApi,
  PancakeOrderOpenApiError,
} from "../src/integrations/pancake/order-openapi-contract.ts";

const MAX_EVIDENCE_FILE_BYTES = 16 * 1024 * 1024;
const FILE_REQUIRED = "OPENAPI_EVIDENCE_FILE_REQUIRED";
const FILE_UNREADABLE = "OPENAPI_EVIDENCE_FILE_UNREADABLE";
const FILE_TOO_LARGE = "OPENAPI_EVIDENCE_FILE_TOO_LARGE";
const GENERIC_FAILURE = "OPENAPI_EVIDENCE_INSPECTION_FAILED";
const SAFE_LOCAL_FAILURES = new Set([FILE_REQUIRED, FILE_UNREADABLE, FILE_TOO_LARGE]);

export function trustedLocalOpenApiFailureMessage(error: unknown): string {
  if (error instanceof PancakeOrderOpenApiError) {
    return error.code;
  }
  if (error instanceof Error && SAFE_LOCAL_FAILURES.has(error.message)) {
    return error.message;
  }
  return GENERIC_FAILURE;
}

export async function inspectTrustedLocalPancakeOrderOpenApi(filePath: string): Promise<void> {
  let metadata;
  try {
    metadata = await stat(filePath);
  } catch {
    throw new Error(FILE_UNREADABLE);
  }

  if (!metadata.isFile()) {
    throw new Error(FILE_UNREADABLE);
  }
  if (metadata.size > MAX_EVIDENCE_FILE_BYTES) {
    throw new Error(FILE_TOO_LARGE);
  }

  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch {
    throw new Error(FILE_UNREADABLE);
  }

  let document: unknown;
  try {
    document = JSON.parse(source);
  } catch {
    throw new PancakeOrderOpenApiError("MALFORMED_OPENAPI_DOCUMENT");
  }

  const inspection = inspectPancakeCreateOrderOpenApi(document);
  console.log(JSON.stringify(inspection, null, 2));
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
