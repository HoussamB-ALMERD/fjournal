import { randomBytes } from "node:crypto";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes (0/o, 1/l/i)

export function shortId(len = 6): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Citable contribution identifier, e.g. "2026.k3x9qa". */
export function contributionId(): string {
  return `${new Date().getUTCFullYear()}.${shortId(6)}`;
}
