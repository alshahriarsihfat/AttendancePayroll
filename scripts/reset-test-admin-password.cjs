const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = process.cwd();
const envPath = path.join(root, ".env.test");

if (!fs.existsSync(envPath)) {
  console.error("Missing .env.test. Aborting.");
  process.exit(1);
}

const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash || !/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(hash)) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

process.stdout.write("Enter new TEST Admin password: ");
let password = "";
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");

process.stdin.on("data", (key) => {
  if (key === "\u0003") { // Ctrl+C
    process.stdin.setRawMode(false);
    process.stdin.pause();
    console.log("\nAborted.");
    process.exit(1);
  }
  if (key === "\r" || key === "\n") {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\n");
    if (password.length < 8) {
      console.error("Password must be at least 8 characters. Aborting.");
      process.exit(1);
    }
    const newHash = hashPassword(password);
    if (!verifyPassword(password, newHash)) {
      console.error("Hash verification failed. Aborting.");
      process.exit(1);
    }
    const out = [];
    let found = false;
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith("#")) { out.push(rawLine); continue; }
      const idx = trimmed.indexOf("=");
      if (idx === -1) { out.push(rawLine); continue; }
      const keyName = trimmed.slice(0, idx).trim();
      if (keyName === "ADMIN_PASSWORD_HASH") {
        out.push("ADMIN_PASSWORD_HASH=" + newHash);
        found = true;
      } else {
        out.push(rawLine);
      }
    }
    if (!found) {
      console.error("ADMIN_PASSWORD_HASH not found in .env.test. Aborting.");
      process.exit(1);
    }
    fs.writeFileSync(envPath, out.join("\n"), "utf8");
    console.log("Password reset complete. ADMIN_PASSWORD_HASH updated.");
    console.log("Hash verification: OK");
    password = "";
    process.exit(0);
  } else if (key === "\u007f") { // backspace
    if (password.length > 0) {
      password = password.slice(0, -1);
      process.stdout.write("\b \b");
    }
  } else if (key.length === 1) {
    password += key;
    process.stdout.write("*");
  }
});
