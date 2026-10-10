import "server-only";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import type { Readable } from "node:stream";

/**
 * Fetches author-supplied URLs without letting them reach internal networks (SSRF).
 * The address check runs inside the socket's DNS lookup, so it applies to the IP actually
 * connected to — a hostname can't pass validation and then re-resolve to 127.0.0.1.
 */

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) blocked.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const)
  blocked.addSubnet(addr, prefix, "ipv6");

export function isPublicAddress(ip: string): boolean {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return !blocked.check(mapped[1], "ipv4");
  return !blocked.check(ip, net.isIPv6(ip) ? "ipv6" : "ipv4");
}

const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad || list.length === 0) return callback(new Error(`Refusing to connect to non-public address ${bad?.address ?? ""}`), "", 4);
    if ((options as dns.LookupAllOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export class FetchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

type Opened = { stream: Readable; contentType: string; contentLength: number | null; finalUrl: string };

const DEFAULT_HEADERS = { "user-agent": "Fjournal-integrity-checker/1.0" };

function openOnce(url: URL, timeoutMs: number, headers: Record<string, string>): Promise<{ res: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    if (url.protocol !== "http:" && url.protocol !== "https:") return reject(new FetchError("Only http(s) URLs are allowed."));
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, "")) && !isPublicAddress(url.hostname.replace(/^\[|\]$/g, "")))
      return reject(new FetchError("Refusing to connect to a non-public address."));
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.get(url, { lookup: guardedLookup, timeout: timeoutMs, headers: { ...DEFAULT_HEADERS, ...headers } }, (res) =>
      resolve({ res }),
    );
    req.on("timeout", () => req.destroy(new FetchError(`Timed out after ${timeoutMs / 1000}s.`)));
    req.on("error", (e) => reject(e instanceof FetchError ? e : new FetchError(e.message)));
  });
}

/** Opens a URL (following up to 3 redirects, each re-validated). Caller must consume or destroy the stream. */
export async function safeOpen(raw: string, timeoutMs = 15_000, headers: Record<string, string> = {}): Promise<Opened> {
  let url = new URL(raw);
  for (let hop = 0; hop <= 3; hop++) {
    const { res } = await openOnce(url, timeoutMs, headers);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      url = new URL(res.headers.location, url);
      continue;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new FetchError(`Server answered HTTP ${status}.`, status);
    }
    const len = Number(res.headers["content-length"]);
    return {
      stream: res,
      contentType: String(res.headers["content-type"] ?? ""),
      contentLength: Number.isFinite(len) ? len : null,
      finalUrl: url.toString(),
    };
  }
  throw new FetchError("Too many redirects.");
}

/** Reads a whole response into memory, refusing anything larger than maxBytes. */
export async function safeFetchBuffer(raw: string, maxBytes: number, timeoutMs?: number, headers?: Record<string, string>) {
  const o = await safeOpen(raw, timeoutMs, headers);
  if (o.contentLength !== null && o.contentLength > maxBytes) {
    o.stream.destroy();
    throw new FetchError(`File is larger than ${Math.round(maxBytes / 1e6)} MB.`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of o.stream) {
    size += chunk.length;
    if (size > maxBytes) {
      o.stream.destroy();
      throw new FetchError(`File is larger than ${Math.round(maxBytes / 1e6)} MB.`);
    }
    chunks.push(chunk);
  }
  return { buffer: Buffer.concat(chunks), contentType: o.contentType };
}
