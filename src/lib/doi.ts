import "server-only";
import { get, run, now } from "./db";
import { LICENSES, type License, type SourceRecord } from "./constants";

/**
 * DOIs for reviews, registered with DataCite as resourceTypeGeneral "PeerReview" with a "Reviews"
 * relation to the work, so reviews enter the same citation graph as papers and count as scholarly output.
 *
 * Configure: DATACITE_REPOSITORY_ID, DATACITE_PASSWORD, DATACITE_PREFIX and FJOURNAL_PUBLIC_URL.
 * DATACITE_API defaults to the *test* service (api.test.datacite.org); set it to
 * https://api.datacite.org only for real, permanent DOIs. Findable DOIs can never be deleted.
 */

export class DoiError extends Error {}

export function doiConfig() {
  const repo = process.env.DATACITE_REPOSITORY_ID;
  const password = process.env.DATACITE_PASSWORD;
  const prefix = process.env.DATACITE_PREFIX;
  const site = process.env.FJOURNAL_PUBLIC_URL?.replace(/\/+$/, "");
  if (!repo || !password || !prefix || !site) return null;
  const api = (process.env.DATACITE_API ?? "https://api.test.datacite.org").replace(/\/+$/, "");
  return { repo, password, prefix, site, api, test: api.includes(".test.") };
}

const DAILY_LIMIT = 25;
export const reviewDoiFor = (prefix: string, reviewId: string) => `${prefix}/fj.review.${reviewId}`.toLowerCase();

/** Reserves a DOI for a review. Must run inside tx(). Only the reviewer can ask, once. */
export function reserveReviewDoi(reviewId: string, userId: string): string {
  const cfg = doiConfig();
  if (!cfg) throw new DoiError("DOI registration isn't configured on this Fjournal instance yet.");
  const r = get<{ reviewer_id: string; hidden: number; doi: string | null; doi_status: string | null }>(
    "SELECT reviewer_id, hidden, doi, doi_status FROM reviews WHERE id = ?",
    reviewId,
  );
  if (!r) throw new DoiError("Review not found.");
  if (r.reviewer_id !== userId) throw new DoiError("Only the reviewer can register a DOI for a review.");
  if (r.hidden) throw new DoiError("This review was removed by moderation.");
  if (r.doi_status === "registered" || r.doi_status === "pending") throw new DoiError("This review already has a DOI.");
  const since = new Date(Date.now() - 86400_000).toISOString();
  const recent = get<{ n: number }>("SELECT COUNT(*) AS n FROM reviews WHERE reviewer_id = ? AND doi_requested_at > ?", userId, since)!.n;
  if (recent >= DAILY_LIMIT) throw new DoiError(`You can register up to ${DAILY_LIMIT} review DOIs a day.`);
  const doi = r.doi ?? reviewDoiFor(cfg.prefix, reviewId);
  run("UPDATE reviews SET doi = ?, doi_status = 'pending', doi_error = NULL, doi_requested_at = ? WHERE id = ?", doi, now(), reviewId);
  return doi;
}

type ReviewForDoi = {
  id: string; doi: string; body: string; recommendation: string; license: License | null; created_at: string;
  contribution_id: string; version_number: number;
  display_name: string; orcid: string | null; orcid_verified_at: string | null;
  title: string; source: string | null;
};

/** DataCite metadata (schema 4.5, JSON:API) for one review. */
export function reviewMetadata(r: ReviewForDoi, site: string) {
  const src: SourceRecord | null = r.source ? JSON.parse(r.source) : null;
  const reviewed = src
    ? src.kind === "arxiv"
      ? { relatedIdentifier: src.id, relatedIdentifierType: "arXiv" }
      : { relatedIdentifier: src.id, relatedIdentifierType: "DOI" }
    : { relatedIdentifier: `${site}/c/${r.contribution_id}?v=${r.version_number}`, relatedIdentifierType: "URL" };
  const lic = r.license ? LICENSES[r.license] : null;
  return {
    data: {
      type: "dois",
      attributes: {
        doi: r.doi,
        event: "publish",
        url: `${site}/r/${r.id}`,
        creators: [
          {
            name: r.display_name,
            // Only an iD proven through ORCID sign-in goes into the record, so nobody can attach a review to someone else's iD.
            nameIdentifiers: r.orcid && r.orcid_verified_at
              ? [{ nameIdentifier: `https://orcid.org/${r.orcid}`, nameIdentifierScheme: "ORCID", schemeUri: "https://orcid.org" }]
              : [],
          },
        ],
        titles: [{ title: `Review of "${r.title}"` }],
        publisher: { name: "Fjournal" },
        publicationYear: Number(r.created_at.slice(0, 4)),
        dates: [{ date: r.created_at.slice(0, 10), dateType: "Issued" }],
        types: { resourceTypeGeneral: "PeerReview", resourceType: "Open peer review" },
        relatedIdentifiers: [{ ...reviewed, relationType: "Reviews" }],
        descriptions: [{ description: r.body.slice(0, 2000), descriptionType: "Abstract" }],
        rightsList: lic?.url ? [{ rights: lic.label, rightsUri: lic.url }] : lic ? [{ rights: lic.label }] : [],
        language: "en",
        schemaVersion: "http://datacite.org/schema/kernel-4",
      },
    },
  };
}

/** Sends the metadata to DataCite. Safe to retry: PUT creates or updates the same DOI. */
export async function registerReviewDoi(reviewId: string) {
  const cfg = doiConfig();
  if (!cfg) return;
  const r = get<ReviewForDoi>(
    `SELECT r.id, r.doi, r.body, r.recommendation, r.license, r.created_at, r.contribution_id, r.version_number,
            u.display_name, u.orcid, u.orcid_verified_at, v.title, v.source
     FROM reviews r JOIN users u ON u.id = r.reviewer_id
     JOIN versions v ON v.contribution_id = r.contribution_id AND v.number = r.version_number
     WHERE r.id = ?`,
    reviewId,
  );
  if (!r?.doi) return;
  try {
    const res = await fetch(`${cfg.api}/dois/${encodeURIComponent(r.doi)}`, {
      method: "PUT",
      headers: {
        "content-type": "application/vnd.api+json",
        authorization: `Basic ${Buffer.from(`${cfg.repo}:${cfg.password}`).toString("base64")}`,
      },
      body: JSON.stringify(reviewMetadata(r, cfg.site)),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      throw new Error(`DataCite answered HTTP ${res.status}: ${text}`);
    }
    run("UPDATE reviews SET doi_status = 'registered', doi_error = NULL WHERE id = ?", reviewId);
  } catch (e) {
    run("UPDATE reviews SET doi_status = 'failed', doi_error = ? WHERE id = ?", e instanceof Error ? e.message : String(e), reviewId);
  }
}
