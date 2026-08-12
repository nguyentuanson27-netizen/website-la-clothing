import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { inspectTrustedLocalPancakeGeoOpenApi } from "../../scripts/pancake-geo-openapi-inspect.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = path.join(repoRoot, "scripts/pancake-geo-openapi-inspect.ts");
const MAX_EVIDENCE_FILE_BYTES = 16 * 1024 * 1024;

function runInspector(filePath: string) {
  return spawnSync(process.execPath, ["--experimental-strip-types", scriptPath, filePath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PANCAKE_API_KEY: "must-not-be-read-by-geo-openapi-inspector",
    },
  });
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "la-clothing-geo-openapi-"));
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
    security: [{ API_KEY: [] }],
    components: {
      securitySchemes: {
        API_KEY: { type: "apiKey", in: "query", name: "api_key" },
      },
      parameters: {
        ProvinceFilter: {
          name: "parent_province",
          in: "query",
          required: true,
          schema: { type: "string", example: "EXTERNAL_PROVINCE" },
        },
      },
      schemas: {
        Province: {
          type: "object",
          required: ["external_id", "label"],
          properties: {
            external_id: { type: "string", example: "EXTERNAL_PROVINCE_ID" },
            label: { type: "string", example: "EXTERNAL_PROVINCE_NAME" },
          },
        },
        District: {
          type: "object",
          properties: {
            external_id: { type: "string" },
            parent_province: { type: "string" },
          },
        },
        Commune: {
          type: "object",
          properties: {
            external_id: { type: "string" },
            parent_district: { type: "string" },
          },
        },
      },
    },
    paths: {
      "/geo/provinces": {
        get: {
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/Province" } },
                  example: [{ external_id: "EXTERNAL_PROVINCE_ID" }],
                },
              },
            },
          },
        },
      },
      "/geo/districts": {
        get: {
          parameters: [{ $ref: "#/components/parameters/ProvinceFilter" }],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/District" } },
                },
              },
            },
          },
        },
      },
      "/geo/communes": {
        get: {
          parameters: [
            {
              name: "parent_district",
              in: "query",
              required: true,
              schema: { type: "string", default: "EXTERNAL_DISTRICT" },
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/Commune" } },
                },
              },
            },
          },
        },
      },
    },
  };
}

test("trusted-local geo OpenAPI CLI emits reproducible structural evidence without external samples", async () => {
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
      operations?: Record<string, unknown>;
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
    assert.equal(
      JSON.stringify(output.operations).includes("parent_province"),
      true,
      "actual query parameter names must be evidence, not guessed domain names",
    );
    assert.equal(JSON.stringify(output.operations).includes("parent_district"), true);
    assert.equal(result.stdout.includes("EXTERNAL_PROVINCE_ID"), false);
    assert.equal(result.stdout.includes("EXTERNAL_PROVINCE_NAME"), false);
    assert.equal(result.stdout.includes("EXTERNAL_DISTRICT"), false);
    assert.equal(result.stdout.includes("must-not-be-read-by-geo-openapi-inspector"), false);
  });
});

test("trusted-local geo evidence read cannot outgrow the cap after initial metadata", async () => {
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

  const inspectWithOpen = inspectTrustedLocalPancakeGeoOpenApi as unknown as (
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

test("trusted-local geo OpenAPI CLI fails closed for operation-level deployment/auth overrides", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "override.json");
    const fixture = openApiFixture();
    const get = fixture.paths["/geo/districts"].get as unknown as Record<string, unknown>;
    get.security = [];
    await writeFile(filePath, JSON.stringify(fixture), "utf8");

    const result = runInspector(filePath);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), "MALFORMED_OPENAPI_DOCUMENT");
  });
});

test("trusted-local geo OpenAPI CLI rejects oversized and malformed files with fixed safe messages", async () => {
  await withTempDir(async (dir) => {
    const oversized = path.join(dir, "oversized.json");
    await writeFile(oversized, "", "utf8");
    await truncate(oversized, MAX_EVIDENCE_FILE_BYTES + 1);
    const oversizedResult = runInspector(oversized);
    assert.equal(oversizedResult.status, 1);
    assert.equal(oversizedResult.stdout, "");
    assert.equal(oversizedResult.stderr.trim(), "OPENAPI_EVIDENCE_FILE_TOO_LARGE");

    const malformed = path.join(dir, "malformed.json");
    await writeFile(malformed, '{"openapi":', "utf8");
    const malformedResult = runInspector(malformed);
    assert.equal(malformedResult.status, 1);
    assert.equal(malformedResult.stdout, "");
    assert.equal(malformedResult.stderr.trim(), "MALFORMED_OPENAPI_DOCUMENT");
    assert.equal(malformedResult.stderr.includes(filePath), false);
  });
});
