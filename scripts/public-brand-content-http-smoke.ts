import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const HOST = "127.0.0.1";
const PORT = 3221;
const BASE_URL = `http://${HOST}:${PORT}`;
const nextDevDirectory = new URL("../.next/dev/", import.meta.url);
const require = createRequire(import.meta.url);
const nextCliPath = resolve(dirname(require.resolve("next/package.json")), "dist/bin/next");

let server: ChildProcess | undefined;
let serverOutput = "";

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

function visibleText(body: string): string {
  return body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function anchorHasVisibleText(body: string, href: string, text: string): boolean {
  const anchors = body.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? [];
  return anchors.some((anchor) => {
    const hrefMatch = anchor.match(/\bhref=(?:"([^"]+)"|'([^']+)')/i);
    const anchorHref = hrefMatch?.[1] ?? hrefMatch?.[2] ?? null;
    if (anchorHref !== href) return false;
    const anchorText = anchor.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return anchorText.includes(text);
  });
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js P16A public-brand server exited early with code ${server.exitCode}\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The development server may still be starting or compiling the route.
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for Next.js P16A public-brand server\n${serverOutput}`);
}

async function waitForServerExit(timeoutMs: number): Promise<boolean> {
  if (!server || server.exitCode !== null) return true;
  return Promise.race([
    once(server, "exit").then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  if (await waitForServerExit(5_000)) return;
  server.kill("SIGKILL");
  await waitForServerExit(5_000);
}

try {
  serverOutput = "";
  const environment = { ...process.env };
  delete environment.PANCAKE_SHOP_ID;
  server = spawn(
    process.execPath,
    [nextCliPath, "dev", "--hostname", HOST, "--port", String(PORT)],
    {
      env: {
        ...environment,
        APP_DOMAIN: "shop.example.com",
        SEARCH_INDEXING_ENABLED: "true",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout?.on("data", captureServerOutput);
  server.stderr?.on("data", captureServerOutput);
  await waitForServer();

  const response = await fetch(`${BASE_URL}/`, { redirect: "manual" });
  const body = await response.text();
  assert.equal(response.status, 200, `P16A homepage must return 200\n${serverOutput}`);

  const text = visibleText(body);
  for (const fact of [
    "LA Clothing / About",
    "Minimal, modern menswear by LA Clothing.",
    "Thanh toán khi nhận hàng (COD).",
    "Không cần tài khoản để thanh toán.",
    "Miễn phí vận chuyển",
    "Đơn trên 1.000.000 ₫ hoặc từ 3 sản phẩm.",
    "Giá, tồn kho và phí vận chuyển được máy chủ kiểm tra lại khi bạn đặt hàng.",
  ]) {
    assert.equal(text.includes(fact), true, `homepage must expose factual visible text: ${fact}`);
  }

  assert.equal(anchorHasVisibleText(body, "/shop", "Cửa hàng"), true);
  assert.equal(anchorHasVisibleText(body, "/collections", "Bộ sưu tập"), true);
  assert.equal(anchorHasVisibleText(body, "/track-order", "Tra cứu đơn"), true);

  console.log("P16A public-brand HTTP smoke passed: factual brand/COD/shipping/server-verification content and internal links render in initial HTML.");
} finally {
  await stopServer();
  await rm(nextDevDirectory, { recursive: true, force: true });
}
