import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  // Accounts created through ORCID sign-in have no password at all.
  if (!stored.startsWith("scrypt$")) return false;
  const [, saltHex, keyHex] = stored.split("$");
  const key = Buffer.from(keyHex, "hex");
  const candidate = scryptSync(password, Buffer.from(saltHex, "hex"), key.length);
  return timingSafeEqual(key, candidate);
}
