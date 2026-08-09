import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { prisma } from "../src/db/prisma.ts";

const HOST = "127.0.0.1";
const PORT = 3210;
const BASE_URL = `http://${HOST}:${PORT}`;
const PROBE_PATH = "/__cart-action-http-smoke";
const probeDirectory = new URL("../src/app/__cart-action-http-smoke/", import.meta.url);
const probePage = new URL("page.tsx", probeDirectory);

const runId = `${Date.now()}-${process.pid}`;
const productExternalId = `cart-action-http-smoke-product-${runId}`;
const variationExternalId = `cart-action-http-smoke-variation-${runId}`;
const slug = `cart-action-http-smoke-${runId}`;

let server: ChildProcessWithoutNullStreams | undefined;
let variantId: string | undefined;
let serverOutput = "";

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-12_000);
}

async function waitForProbePage(): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js probe server exited early with code ${server.exitCode}\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${BASE_URL}${PROBE_PATH}`);
      if (response.ok) return await response.text();
    } catch {
      // The development server may still be starting or compiling the temporary route.
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for Next.js Server Action probe route\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;

  server.kill("SIGTERM");
  await Promise.race([once(server, "exit"), delay(5_000)]);
  if (server.exitCode === null) {
    server.kill("SIGKILL");
    await once(server, "exit");
  }
}

async function cleanupDatabase() {
  if (!variantId) {
    await prisma.productMirror.deleteMany({ where: { pancakeProductId: productExternalId } });
    return;
  }

  const carts = await prisma.cart.findMany({
    where: { items: { some: { variantId } } },
    select: { id: true },
  });
  if (carts.length > 0) {
    await prisma.cart.deleteMany({ where: { id: { in: carts.map(({ id }) => id) } } });
  }
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: productExternalId } });
}

try {
  const product = await prisma.productMirror.create({
    data: {
      pancakeProductId: productExternalId,
      slug,
      name: "Cart Server Action HTTP Smoke",
      syncedAt: new Date(),
      variants: {
        create: {
          pancakeVariationId: variationExternalId,
          isActive: true,
          syncedAt: new Date(),
        },
      },
    },
    include: { variants: true },
  });
  variantId = product.variants[0]?.id;
  assert.ok(variantId, "probe variant must exist");

  await mkdir(probeDirectory, { recursive: true });
  await writeFile(
    probePage,
    `import { setAnonymousCartItemQuantity } from "../../commerce/anonymous-cart-actions.ts";\n\nexport const dynamic = "force-dynamic";\n\nexport default function CartActionHttpSmokePage() {\n  async function mutateCart() {\n    "use server";\n    await setAnonymousCartItemQuantity({ variantId: ${JSON.stringify(variantId)}, quantity: 1 });\n  }\n\n  return (\n    <form action={mutateCart}>\n      <button type="submit">Mutate cart</button>\n    </form>\n  );\n}\n`,
    "utf-8",
  );

  server = spawn("pnpm", ["exec", "next", "dev", "--hostname", HOST, "--port", String(PORT)], {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", captureServerOutput);
  server.stderr.on("data", captureServerOutput);

  const html = await waitForProbePage();
  const actionField = html.match(/name="(\$ACTION_[^"]+)"/)?.[1];
  assert.ok(actionField, "server-rendered form must include a progressive-enhancement Server Action field");

  const form = new FormData();
  form.set(actionField, "");
  const response = await fetch(`${BASE_URL}${PROBE_PATH}`, {
    method: "POST",
    headers: {
      accept: "text/html",
      origin: BASE_URL,
    },
    body: form,
    redirect: "manual",
  });

  assert.ok(response.status >= 200 && response.status < 400, `unexpected action status ${response.status}`);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "actual Server Action response must emit Set-Cookie");
  assert.match(setCookie, /(?:^|,\s*)la_cart=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//i);

  const cartId = setCookie.match(/(?:^|,\s*)la_cart=([^;]+)/)?.[1];
  assert.ok(cartId, "Set-Cookie must contain the opaque anonymous cart id");

  const persistedCart = await prisma.cart.findUnique({
    where: { id: decodeURIComponent(cartId) },
    include: { items: true },
  });
  assert.equal(persistedCart?.userId, null);
  assert.deepEqual(
    persistedCart?.items.map(({ variantId: persistedVariantId, quantity }) => ({
      variantId: persistedVariantId,
      quantity,
    })),
    [{ variantId, quantity: 1 }],
  );

  console.log("Server Action HTTP smoke passed: response emitted the HttpOnly anonymous-cart cookie.");
} finally {
  await stopServer();
  await rm(probeDirectory, { recursive: true, force: true });
  await cleanupDatabase();
  await prisma.$disconnect();
}
