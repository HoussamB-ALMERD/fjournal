import "server-only";
import { createHash } from "node:crypto";
import type { Artifact } from "../ledger";
import { safeOpen } from "./safe-fetch";
import type { Finding } from "./stats";

const MAX_HASH_BYTES = 500 * 1024 * 1024;

async function verifySha256(url: string, expected: string): Promise<Finding> {
  const o = await safeOpen(url, 60_000);
  if (o.contentLength !== null && o.contentLength > MAX_HASH_BYTES) {
    o.stream.destroy();
    return { status: "info", text: url, message: "File too large to verify automatically. Verify locally with sha256sum." };
  }
  const h = createHash("sha256");
  let size = 0;
  for await (const chunk of o.stream) {
    size += chunk.length;
    if (size > MAX_HASH_BYTES) {
      o.stream.destroy();
      return { status: "info", text: url, message: "File too large to verify automatically. Verify locally with sha256sum." };
    }
    h.update(chunk);
  }
  const got = h.digest("hex");
  return got === expected.toLowerCase()
    ? { status: "pass", text: url, message: `Downloaded file matches the pinned SHA-256 (${size.toLocaleString()} bytes).` }
    : {
        status: "fail",
        text: url,
        message: `The file at this URL no longer matches the pinned checksum (got ${got.slice(0, 16)}…). Readers may not be getting the data the results were computed from.`,
      };
}

async function verifyGithubCommit(owner: string, repo: string, sha: string, url: string): Promise<Finding> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "Fjournal-integrity-checker" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, { headers, signal: AbortSignal.timeout(15_000) });
  if (res.ok) return { status: "pass", text: url, message: `Pinned commit ${sha} exists in ${owner}/${repo}.` };
  if (res.status === 404 || res.status === 422)
    return { status: "fail", text: url, message: `Commit ${sha} was not found in ${owner}/${repo}. The pinned code may have been rewritten or deleted.` };
  throw new Error(`GitHub answered HTTP ${res.status}${res.status === 403 ? " (rate limited)" : ""}.`);
}

async function verifyDoi(doi: string, url: string): Promise<Finding> {
  const res = await fetch(`https://doi.org/api/handles/${encodeURIComponent(doi)}`, { signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as { responseCode?: number };
  return body.responseCode === 1
    ? { status: "pass", text: url, message: `DOI ${doi} resolves.` }
    : { status: "fail", text: url, message: `DOI ${doi} does not resolve.` };
}

async function reachable(url: string): Promise<Finding> {
  const o = await safeOpen(url);
  o.stream.destroy();
  return { status: "info", text: url, message: "Reachable, but not pinned to a commit, DOI or checksum — readers can't be sure they get the exact version used." };
}

/** Checks that every linked artifact exists and still matches what the version pinned. */
export async function checkArtifacts(artifacts: Artifact[]): Promise<Finding[]> {
  return Promise.all(
    artifacts.map(async (a): Promise<Finding> => {
      const pin = a.pin.trim();
      try {
        const sha = pin.match(/^(?:sha256:)?([0-9a-f]{64})$/i);
        if (sha) return await verifySha256(a.url, sha[1]);
        const gh = a.url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/);
        if (gh && /^[0-9a-f]{7,40}$/i.test(pin)) return await verifyGithubCommit(gh[1], gh[2], pin, a.url);
        const doi = pin.match(/^(?:doi:|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i);
        if (doi) return await verifyDoi(doi[1], a.url);
        return await reachable(a.url);
      } catch (e) {
        return { status: "warn", text: a.url, message: `Could not retrieve: ${(e as Error).message}` };
      }
    }),
  );
}
