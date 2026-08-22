import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const HOST = "127.0.0.1";
const PORT = 3222;
const BASE_URL = `http://${HOST}:${PORT}`;
const nextDevDirectory = new URL("../.next/dev/", import.meta.url);
const require = createRequire(import.meta.url);
const nextCliPath = resolve(dirname(require.resolve("next/package.json")), "dist/bin/next");

let server: ChildProcess | undefined;
let serverOutput = "";

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js P16C robots server exited early with code ${server.exitCode}\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/robots.txt`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The development server may still be starting or compiling the route.
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for Next.js P16C robots server\n${serverOutput}`);
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

function userAgentSection(body: string, userAgent: string): string[] {
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const start = lines.findIndex((line) => line.toLowerCase() === `user-agent: ${userAgent}`.toLowerCase());
  assert.notEqual(start, -1, `robots.txt must contain User-Agent: ${userAgent}`);

  const section: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.toLowerCase().startsWith("user-agent:")) break;
    if (line.length > 0) section.push(line);
  }
  return section;
}

try {
  serverOutput = "";
  server = spawn(
    process.execPath,
    [nextCliPath, "dev", "--hostname", HOST, "--port", String(PORT)],
    {
      env: {
        ...process.env,
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

  const response = await fetch(`${BASE_URL}/robots.txt`, { redirect: "manual" });
  const body = await response.text();
  assert.equal(response.status, 200, `P16C robots.txt must return 200\n${serverOutput}`);

  const oaiRules = userAgentSection(body, "OAI-SearchBot");
  assert.equal(oaiRules.includes("Allow: /"), true, "OAI-SearchBot must be allowed on public HTML");
  assert.equal(oaiRules.includes("Disallow: /api"), true, "OAI-SearchBot must remain blocked from /api");
  assert.equal(oaiRules.includes("Disallow: /"), false, "OAI-SearchBot must not be globally blocked");
  assert.equal(body.includes("Sitemap: https://shop.example.com/sitemap.xml"), true);

  console.log("P16C robots HTTP smoke passed: OAI-SearchBot can crawl public HTML, /api remains blocked, and the canonical sitemap is advertised when indexing is enabled.");
} finally {
  await stopServer();
  await rm(nextDevDirectory, { recursive: true, force: true });
}
