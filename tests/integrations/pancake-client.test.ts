import assert from "node:assert/strict";
import test from "node:test";

import { PancakeClient, PancakeHttpError } from "../../src/integrations/pancake/client.ts";

const API_KEY = "secret-api-key";

test("adds the API key and query params without exposing it to callers", async () => {
  let requestedUrl = "";
  const fetcher: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new PancakeClient({ apiKey: API_KEY, fetcher });
  const result = await client.getJson("/shops/4741464/products/variations", { page: 2 });

  const url = new URL(requestedUrl);
  assert.equal(url.origin + url.pathname, "https://pos.pages.fm/api/v1/shops/4741464/products/variations");
  assert.equal(url.searchParams.get("api_key"), API_KEY);
  assert.equal(url.searchParams.get("page"), "2");
  assert.deepEqual(result, { success: true });
});

test("bounds Pancake requests with an abort signal", async () => {
  let requestSignal: AbortSignal | null | undefined;
  const fetcher: typeof fetch = async (_input, init) => {
    requestSignal = init?.signal;
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new PancakeClient({ apiKey: API_KEY, fetcher, timeoutMs: 2_500 });
  await client.getJson("/shops");

  assert.ok(requestSignal instanceof AbortSignal);
  assert.equal(requestSignal.aborted, false);
});

test("throws a sanitized error that does not reveal the API key", async () => {
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ message: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });

  const client = new PancakeClient({ apiKey: API_KEY, fetcher });

  await assert.rejects(
    () => client.getJson("/shops/4741464/products/variations"),
    (error: unknown) => {
      assert.ok(error instanceof PancakeHttpError);
      assert.equal(error.status, 401);
      assert.equal(error.endpoint, "/shops/4741464/products/variations");
      assert.equal(error.message.includes(API_KEY), false);
      return true;
    },
  );
});

test("rejects endpoints outside the Pancake API path", async () => {
  const client = new PancakeClient({ apiKey: API_KEY, fetcher: fetch });

  await assert.rejects(
    () => client.getJson("https://attacker.example/collect"),
    /Pancake endpoint must start/,
  );
});

test("rejects encoded traversal after URL canonicalization before making a request", async () => {
  let requestCount = 0;
  const fetcher: typeof fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new PancakeClient({ apiKey: API_KEY, fetcher });

  for (const endpoint of ["/%2e%2e/x", "/.%2e/x", "/%2e./x"]) {
    await assert.rejects(
      () => client.getJson(endpoint),
      /Pancake endpoint must remain within the API prefix/,
    );
  }

  assert.equal(requestCount, 0);
});

test("sanitizes transport failures that may include the credentialed URL", async () => {
  const fetcher: typeof fetch = async () => {
    throw new Error(`network failure for https://pos.pages.fm/api/v1/test?api_key=${API_KEY}`);
  };

  const client = new PancakeClient({ apiKey: API_KEY, fetcher });

  await assert.rejects(
    () => client.getJson("/shops/4741464/products/variations"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(API_KEY), false);
      assert.match(error.message, /Pancake request could not be completed/);
      return true;
    },
  );
});
