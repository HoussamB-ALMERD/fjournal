import "server-only";

/**
 * ORCID sign-in (OAuth 2, /authenticate scope) and the public ORCID API.
 * Configure with ORCID_CLIENT_ID and ORCID_CLIENT_SECRET from https://orcid.org/developer-tools.
 * For testing, ORCID_BASE=https://sandbox.orcid.org and ORCID_API_BASE=https://pub.sandbox.orcid.org.
 * The public API needs no credentials, so authorship checks work for any verified iD.
 */

export const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

/** ISO 7064 11,2 — the checksum in the last character of every ORCID iD. */
export function validOrcid(id: string): boolean {
  if (!ORCID_RE.test(id)) return false;
  const digits = id.replace(/-/g, "");
  let total = 0;
  for (const ch of digits.slice(0, -1)) total = (total + Number(ch)) * 2;
  const check = (12 - (total % 11)) % 11;
  return digits.at(-1) === (check === 10 ? "X" : String(check));
}

export function orcidConfig() {
  const clientId = process.env.ORCID_CLIENT_ID;
  const clientSecret = process.env.ORCID_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    base: (process.env.ORCID_BASE ?? "https://orcid.org").replace(/\/+$/, ""),
  };
}

const apiBase = () => (process.env.ORCID_API_BASE ?? "https://pub.orcid.org").replace(/\/+$/, "");

export function authorizeUrl(state: string, redirectUri: string) {
  const c = orcidConfig()!;
  const q = new URLSearchParams({ client_id: c.clientId, response_type: "code", scope: "/authenticate", redirect_uri: redirectUri, state });
  return `${c.base}/oauth/authorize?${q}`;
}

export class OrcidError extends Error {}

/** Trades the one-time code for the person's verified iD and name. */
export async function exchangeCode(code: string, redirectUri: string): Promise<{ orcid: string; name: string }> {
  const c = orcidConfig()!;
  const res = await fetch(`${c.base}/oauth/token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new OrcidError(`ORCID refused the sign-in (HTTP ${res.status}).`);
  const j = (await res.json()) as { orcid?: string; name?: string };
  if (!j.orcid || !validOrcid(j.orcid)) throw new OrcidError("ORCID did not return a valid iD.");
  return { orcid: j.orcid, name: (j.name ?? "").trim() };
}

type WorksResponse = {
  group?: { "external-ids"?: { "external-id"?: { "external-id-type": string; "external-id-value": string }[] } }[];
};

/** Every DOI and arXiv ID listed on a person's public ORCID record, normalised for comparison. */
export async function orcidWorkIds(orcid: string): Promise<Set<string>> {
  const res = await fetch(`${apiBase()}/v3.0/${orcid}/works`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new OrcidError(`Couldn't read the ORCID record (HTTP ${res.status}).`);
  const j = (await res.json()) as WorksResponse;
  const ids = new Set<string>();
  for (const g of j.group ?? [])
    for (const e of g["external-ids"]?.["external-id"] ?? []) {
      const v = e["external-id-value"].trim().toLowerCase();
      if (e["external-id-type"] === "doi") ids.add(`doi:${v.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}`);
      if (e["external-id-type"] === "arxiv") ids.add(`arxiv:${v.replace(/^arxiv:/, "").replace(/v\d+$/, "")}`);
    }
  return ids;
}
