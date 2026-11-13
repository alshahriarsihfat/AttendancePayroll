import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

function parseEnvFile(filePath) {
  const result = {};
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const root = process.cwd();
const testEnvPath = path.join(root, ".env.test");
if (!existsSync(testEnvPath)) {
  console.error("Missing .env.test. Aborting to avoid production database usage.");
  process.exit(1);
}

const testEnv = parseEnvFile(testEnvPath);
if (!testEnv.DATABASE_URL || !testEnv.DATABASE_URL.trim()) {
  console.error("DATABASE_URL is missing or empty in .env.test. Aborting.");
  process.exit(1);
}

let prodEnv = {};
const prodEnvPath = path.join(root, ".env");
if (existsSync(prodEnvPath)) prodEnv = parseEnvFile(prodEnvPath);

if (prodEnv.DATABASE_URL && prodEnv.DATABASE_URL === testEnv.DATABASE_URL) {
  console.error("TEST and production DATABASE_URL are identical. Refusing to run.");
  process.exit(1);
}

const childEnv = { ...process.env, ...testEnv };
// Ensure test DATABASE_URL cannot be overridden by inherited empty value
childEnv.DATABASE_URL = testEnv.DATABASE_URL;

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/run-with-test-env.mjs <command> [args...]");
  process.exit(1);
}

const child = spawn(args[0], args.slice(1), { stdio: "inherit", env: childEnv, shell: true });
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => { console.error(err); process.exit(1); });
