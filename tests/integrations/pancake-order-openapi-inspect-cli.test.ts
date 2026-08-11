import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { inspectTrustedLocalPancakeOrderOpenApi } from "../../scripts/pancake-order-openapi-inspect.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = path.join(repoRoot, "scripts/pancake-order-openapi-inspect.ts");
const MAX_EVIDENCE_FILE_BYTES = 16 * 1024 * 1024;

function runInspector(filePath: string) {
  return spawnSync(process.execPath, ["--experimental-strip-types", scriptPath, filePath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PANCAKE_API_KEY: "must-not-be-read-by-local-openapi-inspector",
    },
  });
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "la-clothing-openapi-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function openApiFixture() {
  return {
    openapi: "3.1.0",
    info: { title: "Pancake POS Open API", version: "1.0.0" },
    servers: [{ url: "https://pos.pages.fm/api/v1" }],
    components: {
      securitySchemes: {
        API_KEY: { type: "apiKey", in: "query", name: "api_key" },
      },
    },
    security: [{ API_KEY: [] }],
    paths: {
      "/shops/{SHOP_ID}/orders": {
        parameters: [
          {
            name: "SHOP_ID",
            in: "path",
            required: true,
            schema: { type: "integer", example: 6036602 },
          },
        ],
        post: {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["customer"],
                  properties: {
                    customer: {
                      type: "string",
                      example: "EXTERNAL_SECRET_SAMPLE",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string", example: "EXTERNAL_ORDER_ID" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

test("trusted-local OpenAPI evidence CLI emits a reproducible safe evidence envelope", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "pancake-openapi.json");
    const source = JSON.stringify(openApiFixture());
    await writeFile(filePath, source, "utf8");

    const result = runInspector(filePath);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout) as {
      source?: Record<string, unknown>;
      auth?: Record<string, unknown>;
      operation?: Record<string, unknown>;
    };
    assert.deepEqual(output.source, {
      sha256: createHash("sha256").update(source).digest("hex"),
      bytes: Buffer.byteLength(source),
      openapi: "3.1.0",
      title: "Pancake POS Open API",
      version: "1.0.0",
      server: "https://pos.pages.fm/api/v1",
    });
    assert.deepEqual(output.auth, { type: "apiKey", in: "query", name: "api_key" });
    assert.equal(output.operation?.path, "/shops/{SHOP_ID}/orders");
    assert.equal(output.operation?.method, "POST");
    assert.equal(result.stdout.includes("EXTERNAL_SECRET_SAMPLE"), false);
    assert.equal(result.stdout.includes("EXTERNAL_ORDER_ID"), false);
    assert.equal(result.stdout.includes("must-not-be-read-by-local-openapi-inspector"), false);
  });
});

test("trusted-local OpenAPI evidence read cannot outgrow the cap after initial metadata", async () => {
  const bytes = Buffer.alloc(MAX_EVIDENCE_FILE_BYTES + 1, 0x20);
  let position = 0;
  let closed = false;
  const fakeHandle = {
    async stat() {
      return { isFile: () => true, size: 1 };
    },
    async read(buffer: Uint8Array, offset: number, length: number) {
      const bytesRead = Math.min(length, bytes.length - position);
      if (bytesRead > 0) {
        buffer.set(bytes.subarray(position, position + bytesRead), offset);
        position += bytesRead;
      }
      return { bytesRead, buffer };
    },
    async close() {
      closed = true;
    },
  };

  const inspectWithOpen = inspectTrustedLocalPancakeOrderOpenApi as unknown as (
    filePath: string,
    dependencies: { openFile: () => Promise<typeof fakeHandle> },
  ) => Promise<void>;

  await assert.rejects(
    () => inspectWithOpen("ignored-by-injected-open", { openFile: async () => fakeHandle }),
    (error: unknown) => error instanceof Error && error.message === "OPENAPI_EVIDENCE_FILE_TOO_LARGE",
  );
  assert.equal(closed, true);
  assert.equal(position, MAX_EVIDENCE_FILE_BYTES + 1);
});

test("trusted-local OpenAPI evidence CLI fails closed for malformed JSON without parser detail leakage", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "malformed.json");
    await writeFile(filePath, '{"openapi":', "utf8");

    const result = runInspector(filePath);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), "MALFORMED_OPENAPI_DOCUMENT");
    assert.equal(result.stderr.includes("Unexpected"), false);
    assert.equal(result.stderr.includes(filePath), false);
  });
});

test("trusted-local OpenAPI evidence CLI rejects an oversized file before parsing it", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "oversized.json");
    await writeFile(filePath, "", "utf8");
    await truncate(filePath, MAX_EVIDENCE_FILE_BYTES + 1);

    const result = runInspector(filePath);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), "OPENAPI_EVIDENCE_FILE_TOO_LARGE");
    assert.equal(result.stderr.includes(filePath), false);
  });
});
