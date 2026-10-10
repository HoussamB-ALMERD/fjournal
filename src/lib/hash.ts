import { createHash } from "node:crypto";

/** Hashing shared by the ledgers and the migrations that backfill them. Pure: no database access. */

export const GENESIS = "0".repeat(64);

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Deterministic JSON: object keys sorted recursively, so the same content always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * What a review commits to. It includes the content hash of the exact version reviewed, so a review
 * can never be quietly re-attached to different content, and the review can never be quietly edited.
 */
export type ReviewContent = {
  contribution_id: string;
  version_number: number;
  version_content_hash: string;
  reviewer_id: string;
  soundness: number;
  reproducibility: number;
  clarity: number;
  significance: number;
  recommendation: string;
  body: string;
  competing_interests: string | null; // null on reviews from before declarations were asked
  license: string | null; // null on reviews from before reviewers chose a license
  created_at: string;
};

export const reviewContentHash = (c: ReviewContent) =>
  sha256(canonicalJson({ ...c, competing_interests: c.competing_interests ?? undefined, license: c.license ?? undefined }));

export const reviewChainHash = (prev: string, content: string, reviewId: string, createdAt: string) =>
  sha256(`review|${prev}|${content}|${reviewId}|${createdAt}`);

/**
 * One entry in a collection's public log: a board change or an editorial decision. The payload holds
 * everything the decision rests on (e.g. the selected version's content hash and the policy in force).
 */
export type CollectionEntry = {
  collection_id: string;
  kind: string;
  actor_id: string;
  subject: string | null;
  payload: unknown;
  created_at: string;
};

export const collectionEntryHash = (e: CollectionEntry) =>
  sha256(canonicalJson({ ...e, subject: e.subject ?? undefined }));

export const collectionChainHash = (prev: string, content: string, createdAt: string) =>
  sha256(`collection|${prev}|${content}|${createdAt}`);

/** Reads everything a review hash needs, given a row from `reviews` joined with its version's content_hash. */
export const reviewContentOf = (r: ReviewContent): ReviewContent => ({
  contribution_id: r.contribution_id,
  version_number: r.version_number,
  version_content_hash: r.version_content_hash,
  reviewer_id: r.reviewer_id,
  soundness: r.soundness,
  reproducibility: r.reproducibility,
  clarity: r.clarity,
  significance: r.significance,
  recommendation: r.recommendation,
  body: r.body,
  competing_interests: r.competing_interests,
  license: r.license,
  created_at: r.created_at,
});

/** SQL that yields ReviewContent columns for review rows (alias r) — used by the ledger and its backfill. */
export const REVIEW_CONTENT_SQL = `
  SELECT r.id, r.contribution_id, r.version_number, v.content_hash AS version_content_hash, r.reviewer_id,
         r.soundness, r.reproducibility, r.clarity, r.significance, r.recommendation, r.body,
         r.competing_interests, r.license, r.created_at
  FROM reviews r JOIN versions v ON v.contribution_id = r.contribution_id AND v.number = r.version_number`;
