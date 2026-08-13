import { validateReleaseEnvironment } from "../src/operations/release-readiness.ts";

try {
  const summary = validateReleaseEnvironment(process.env);
  process.stdout.write(`${JSON.stringify({ ok: true, ...summary })}\n`);
} catch (error) {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : "Unknown release configuration error";
  process.stderr.write(`Release readiness failed: ${name}: ${message}\n`);
  process.exitCode = 1;
}
