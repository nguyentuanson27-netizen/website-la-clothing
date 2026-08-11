import assert from "node:assert/strict";
import test from "node:test";

import {
  PancakeClient,
  PancakeHttpError,
  PancakeNetworkError,
} from "../../src/integrations/pancake/client.ts";

const API_KEY = "secret-api-key";
const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;

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

test("aborts a stalled Pancake request and reports a sanitized network failure", async () => {
  const fetcher: typeof fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("missing abort signal"));
        return;
      }

      const keepAlive = setTimeout(() => reject(new Error("Pancake timeout signal did not abort")), 250);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(keepAlive);
          reject(signal.reason);
        },
        { once: true },
      );
    });

  const client = new PancakeClient({ apiKey: API_KEY, fetcher, timeoutMs: 10 });

  await assert.rejects(
    () => client.getJson("/shops"),
    (error: unknown) => {
      assert.ok(error instanceof PancakeNetworkError);
      assert.equal(error.endpoint, "/shops");
      assert.equal(error.message.includes(API_KEY), false);
      return true;
    },
  );
});

test("rejects invalid Pancake request timeout configuration", () => {
  assert.throws(
    () => new PancakeClient({ apiKey: API_KEY, timeoutMs: 0 }),
    /Pancake request timeout must be a positive integer/,
  );
});

test("rejects timeout values above the Node timer range before making a request", () => {
  assert.throws(
    () => new PancakeClient({ apiKey: API_KEY, timeoutMs: MAX_NODE_TIMER_DELAY_MS + 1 }),
    /Pancake request timeout must not exceed 2147483647 milliseconds/,
  );
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

test("posts JSON with the same bounded credentialed transport boundary", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const body = {
    shop_id: 4_741_464,
    note: "sensitive-order-note",
    items: [{ variation_id: "variation-001", quantity: 1 }],
  };
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return new Response(JSON.stringify({ id: 700_001 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new PancakeClient({ apiKey: API_KEY, fetcher, timeoutMs: 2_500 });
  const result = await client.postJson("/shops/4741464/orders", body);

  const url = new URL(requestedUrl);
  assert.equal(url.origin + url.pathname, "https://pos.pages.fm/api/v1/shops/4741464/orders");
  assert.equal(url.searchParams.get("api_key"), API_KEY);
  assert.equal(requestedInit?.method, "POST");
  assert.deepEqual(requestedInit?.headers, {
    accept: "application/json",
    "content-type": "application/json",
  });
  assert.equal(requestedInit?.body, JSON.stringify(body));
  assert.ok(requestedInit?.signal instanceof AbortSignal);
  assert.equal(requestedInit.signal.aborted, false);
  assert.deepEqual(result, { id: 700_001 });
});

test("POST HTTP rejection is sanitized and never exposes request JSON or API key", async () => {
  const sensitiveValue = "sensitive-order-note";
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ detail: `${API_KEY}:${sensitiveValue}` }), {
      status: 422,
      headers: { "content-type": "application/json" },
    });
  const client = new PancakeClient({ apiKey: API_KEY, fetcher });

  await assert.rejects(
    () => client.postJson("/shops/4741464/orders", { note: sensitiveValue }),
    (error: unknown) => {
      assert.ok(error instanceof PancakeHttpError);
      assert.equal(error.status, 422);
      assert.equal(error.endpoint, "/shops/4741464/orders");
      assert.equal(error.message.includes(API_KEY), false);
      assert.equal(error.message.includes(sensitiveValue), false);
      return true;
    },
  );
});

test("POST transport failures are sanitized and do not echo request JSON", async () => {
  const sensitiveValue = "sensitive-order-note";
  const fetcher: typeof fetch = async () => {
    throw new Error(`${API_KEY}:${sensitiveValue}`);
  };
  const client = new PancakeClient({ apiKey: API_KEY, fetcher });

  await assert.rejects(
    () => client.postJson("/shops/4741464/orders", { note: sensitiveValue }),
    (error: unknown) => {
      assert.ok(error instanceof PancakeNetworkError);
      assert.equal(error.endpoint, "/shops/4741464/orders");
      assert.equal(error.message.includes(API_KEY), false);
      assert.equal(error.message.includes(sensitiveValue), false);
      return true;
    },
  );
});
