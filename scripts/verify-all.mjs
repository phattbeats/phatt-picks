// PHA-925 — run the entire offline verify-*.ts harness through one command.
//
//   node scripts/verify-all.mjs
//
// Each verify-*.ts is spawned under `--experimental-strip-types` with the
// extensionless-import resolver hook (register-ts-resolve.mjs) so scripts whose
// import chain reaches a value import of an extensionless relative module
// (e.g. ./swiss-bucket-core) load cleanly — matching the app's bundler
// resolution without touching the source imports.
//
// Exit code is non-zero if any script exits non-zero, so CI can gate on it.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const verifyScripts = readdirSync(scriptsDir)
  .filter((f) => f.startsWith("verify-") && f.endsWith(".ts"))
  .sort();

if (verifyScripts.length === 0) {
  console.error("No verify-*.ts scripts found in", scriptsDir);
  process.exit(1);
}

const failures = [];
for (const script of verifyScripts) {
  process.stdout.write(`\n──────── ${script} ────────\n`);
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      "./register-ts-resolve.mjs",
      "--no-warnings",
      script,
    ],
    { cwd: scriptsDir, stdio: "inherit" },
  );
  if (result.status !== 0) failures.push(script);
}

process.stdout.write("\n════════ verify-all summary ════════\n");
process.stdout.write(`${verifyScripts.length} scripts run, ${failures.length} failed\n`);
if (failures.length) {
  process.stdout.write(`FAILED: ${failures.join(", ")}\n`);
  process.exit(1);
}
process.stdout.write("ALL GREEN\n");
