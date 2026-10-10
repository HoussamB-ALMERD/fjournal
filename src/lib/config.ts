import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { get, run } from "./db";

/** The address the outside world uses for this deployment: DOIs and ORCID redirects point here. */
export async function publicUrl(): Promise<string> {
  const configured = process.env.FJOURNAL_PUBLIC_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Signing key: FJOURNAL_SECRET if set, otherwise generated once and kept in the database. */
function appSecret(): string {
  if (process.env.FJOURNAL_SECRET) return process.env.FJOURNAL_SECRET;
  const row = get<{ value: string }>("SELECT value FROM meta WHERE key = 'secret'");
  if (row) return row.value;
  const value = randomBytes(32).toString("hex");
  run("INSERT OR IGNORE INTO meta (key, value) VALUES ('secret', ?)", value);
  return get<{ value: string }>("SELECT value FROM meta WHERE key = 'secret'")!.value;
}

/** A tamper-proof, expiring value for a cookie. */
export function sign(payload: object, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })).toString("base64url");
  const mac = createHmac("sha256", appSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function unsign<T>(token: string | undefined): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", appSecret()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString()) as T & { exp: number };
  return data.exp > Date.now() ? data : null;
}
