import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

test("trusted-local OpenAPI evidence CLI prints only the sanitized create-order structure", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "pancake-openapi.json");
    await writeFile(
      filePath,
      JSON.stringify({
        openapi: "3.1.0",
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
      }),
      "utf8",
    );

    const result = runInspector(filePath);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(output.path, "/shops/{SHOP_ID}/orders");
    assert.equal(output.method, "POST");
    assert.equal(result.stdout.includes("EXTERNAL_SECRET_SAMPLE"), false);
    assert.equal(result.stdout.includes("EXTERNAL_ORDER_ID"), false);
    assert.equal(result.stdout.includes("must-not-be-read-by-local-openapi-inspector"), false);
  });
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
