import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// ============================================================================
// Password hashing — salted scrypt (Node built-in, zero dependencies).
//
// Stored format: `${saltHex}:${hashHex}`  (16-byte random salt, 64-byte key).
// A single global secret is NOT used, so DB leaks do not compromise passwords.
// ============================================================================

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

export function isHashedPassword(stored: string): boolean {
  return /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(stored);
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash || !/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(hash)) {
    return false;
  }
  const candidate = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}