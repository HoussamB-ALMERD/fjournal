import "server-only";
import { all, get } from "./db";
import type { Artifact } from "./ledger";
import type { ContributionType, Declarations, License, Recommendation, ReplicationOutcome, SourceKind, SourceRecord } from "./constants";
import { scrutiny } from "./scrutiny";
import { reputationOf, weightFromReputation } from "./reputation";
import { computationallyReproduced } from "./repro/runs";
import { selectionsFor } from "./collections";

export type VersionRow = {
  seq: number;
  contribution_id: string;
  number: number;
  title: string;
  abstract: string;
  body: string;
  authors: string[];
  license: License;
  artifacts: Artifact[];
  declarations: Declarations | null; // null on versions published before declarations existed
  source: SourceRecord | null; // only on imported works
  change_note: string;
  content_hash: string;
  prev_chain_hash: string;
  chain_hash: string;
  created_by: string;
  created_at: string;
};

export type ContributionRow = {
  id: string;
  type: ContributionType;
  owner_id: string | null; // null for imported works
  owner_handle: string | null;
  owner_name: string | null;
  source_kind: SourceKind | null; // set when the work was published elsewhere and imported for review
  source_id: string | null;
  imported_by: string | null;
  importer_handle: string | null;
  latest_version: number;
  replication_of: string | null;
  replication_outcome: ReplicationOutcome | null;
  status: "active" | "retracted" | "hidden";
  created_at: string;
  updated_at: string;
};

type RawVersion = Omit<VersionRow, "authors" | "artifacts" | "declarations" | "source"> & {
  authors: string;
  artifacts: string;
  declarations: string | null;
  source: string | null;
};
const parseVersion = (r: RawVersion): VersionRow => ({
  ...r,
  authors: JSON.parse(r.authors),
  artifacts: JSON.parse(r.artifacts),
  declarations: r.declarations ? JSON.parse(r.declarations) : null,
  source: r.source ? JSON.parse(r.source) : null,
});

const CONTRIB_SELECT = `
  SELECT c.*, u.handle AS owner_handle, u.display_name AS owner_name, i.handle AS importer_handle
  FROM contributions c
  LEFT JOIN users u ON u.id = c.owner_id
  LEFT JOIN users i ON i.id = c.imported_by`;

export function getContribution(id: string) {
  return get<ContributionRow>(`${CONTRIB_SELECT} WHERE c.id = ?`, id);
}

export async function getVersion(contributionId: string, number: number) {
  const r = await get<RawVersion>("SELECT * FROM versions WHERE contribution_id = ? AND number = ?", contributionId, number);
  return r ? parseVersion(r) : undefined;
}

export async function listVersions(contributionId: string) {
  return (await all<RawVersion>("SELECT * FROM versions WHERE contribution_id = ? ORDER BY number DESC", contributionId)).map(parseVersion);
}

export type ReviewRow = {
  id: string;
  contribution_id: string;
  version_number: number;
  reviewer_id: string;
  reviewer_handle: string;
  reviewer_name: string;
  soundness: number;
  reproducibility: number;
  clarity: number;
  significance: number;
  recommendation: Recommendation;
  body: string;
  competing_interests: string | null;
  license: License | null;
  doi: string | null;
  doi_status: "pending" | "registered" | "failed" | null;
  doi_error: string | null;
  reviewer_orcid: string | null; // verified iDs only
  ledger_seq: number | null;
  ledger_hash: string | null;
  ledger_chain_hash: string | null;
  hidden: number;
  created_at: string;
  helpful: number;
};

const REVIEW_SELECT = `
  SELECT r.*, u.handle AS reviewer_handle, u.display_name AS reviewer_name,
     CASE WHEN u.orcid_verified_at IS NOT NULL THEN u.orcid END AS reviewer_orcid,
     l.seq AS ledger_seq, l.content_hash AS ledger_hash, l.chain_hash AS ledger_chain_hash,
     (SELECT COUNT(*) FROM review_votes v WHERE v.review_id = r.id) AS helpful
  FROM reviews r JOIN users u ON u.id = r.reviewer_id
  LEFT JOIN review_ledger l ON l.review_id = r.id`;

export function listReviews(contributionId: string) {
  return all<ReviewRow>(`${REVIEW_SELECT} WHERE r.contribution_id = ? ORDER BY helpful DESC, r.created_at ASC`, contributionId);
}

export function getReview(id: string) {
  return get<ReviewRow>(`${REVIEW_SELECT} WHERE r.id = ?`, id);
}

export async function votedReviewIds(userId: string, contributionId: string): Promise<Set<string>> {
  const rows = await all<{ review_id: string }>(
    `SELECT v.review_id FROM review_votes v JOIN reviews r ON r.id = v.review_id
     WHERE v.voter_id = ? AND r.contribution_id = ?`,
    userId,
    contributionId,
  );
  return new Set(rows.map((r) => r.review_id));
}

export function listReplications(contributionId: string) {
  return all<ContributionRow & { title: string }>(
    `${CONTRIB_SELECT.replace("SELECT c.*", "SELECT c.*, v.title")}
     JOIN versions v ON v.contribution_id = c.id AND v.number = c.latest_version
     WHERE c.replication_of = ? AND c.status <> 'hidden' ORDER BY c.created_at ASC`,
    contributionId,
  );
}

export function listEndorsements(contributionId: string) {
  return all<{ user_id: string; handle: string; display_name: string; note: string; created_at: string }>(
    `SELECT e.user_id, u.handle, u.display_name, e.note, e.created_at
     FROM endorsements e JOIN users u ON u.id = e.user_id
     WHERE e.contribution_id = ? ORDER BY e.created_at ASC`,
    contributionId,
  );
}

export function listComments(contributionId: string) {
  return all<{ id: string; version_number: number; handle: string; display_name: string; body: string; hidden: number; created_at: string }>(
    `SELECT c.id, c.version_number, u.handle, u.display_name, c.body, c.hidden, c.created_at
     FROM comments c JOIN users u ON u.id = c.author_id
     WHERE c.contribution_id = ? ORDER BY c.created_at ASC`,
    contributionId,
  );
}

export async function scrutinyFor(contributionId: string, artifacts: Artifact[], versions: number) {
  const [reviewRows, replications, endorsed, computational] = await Promise.all([
    // Each reviewer's reputation comes with their review, so weights take one query, not one per reviewer.
    all<{ reviewer_id: string; soundness: number; reproducibility: number; rep: number }>(
      `SELECT r.reviewer_id, r.soundness, r.reproducibility,
         COALESCE((SELECT SUM(e.points) FROM reputation_events e WHERE e.user_id = r.reviewer_id), 0) AS rep
       FROM reviews r WHERE r.contribution_id = ? AND r.hidden = 0`,
      contributionId,
    ),
    all<{ outcome: ReplicationOutcome | null }>(
      "SELECT replication_outcome AS outcome FROM contributions WHERE replication_of = ? AND status = 'active'",
      contributionId,
    ),
    get<{ n: number }>("SELECT COUNT(*) AS n FROM endorsements WHERE contribution_id = ?", contributionId),
    computationallyReproduced(contributionId),
  ]);
  const reviews = reviewRows.map((r) => ({ ...r, weight: weightFromReputation(r.rep) }));
  return scrutiny({ reviews, replications, endorsements: endorsed?.n ?? 0, artifacts, versions, computational });
}

export type FeedItem = ContributionRow & {
  source: SourceRecord | null;
  title: string;
  abstract: string;
  authors: string[];
  license: License;
  review_count: number;
  replication_count: number;
  endorsement_count: number;
  scrutiny: ReturnType<typeof scrutiny>;
  collections: { slug: string; name: string; accent: string }[]; // collections that selected it
};

export type FeedSort = "latest" | "needs-review" | "most-scrutinized" | "replications-negative";
export type FeedOrigin = "fjournal" | "imported";

export async function feed(
  opts: { sort?: FeedSort; type?: ContributionType; owner?: string; q?: string; origin?: FeedOrigin; collection?: string; limit?: number } = {},
): Promise<FeedItem[]> {
  const where: string[] = ["c.status <> 'hidden'"];
  const params: string[] = [];
  // A collection's selections, most recently selected first unless another order is asked for.
  const join = opts.collection
    ? "JOIN collection_items ci ON ci.contribution_id = c.id AND ci.status = 'selected' AND ci.collection_id = ?"
    : "";
  if (opts.collection) params.push(opts.collection);
  if (opts.origin === "fjournal") where.push("c.source_kind IS NULL");
  if (opts.origin === "imported") where.push("c.source_kind IS NOT NULL");
  if (opts.type) {
    where.push("c.type = ?");
    params.push(opts.type);
  }
  if (opts.sort === "replications-negative") where.push("c.type IN ('replication','negative_result')");
  if (opts.owner) {
    where.push("c.owner_id = ?");
    params.push(opts.owner);
  }
  if (opts.q) {
    where.push("(v.title ILIKE ? OR v.abstract ILIKE ? OR v.authors ILIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  // Ordered on the outer query, because Postgres doesn't allow output aliases inside ORDER BY expressions.
  const order =
    opts.sort === "needs-review"
      ? "review_count ASC, created_at DESC"
      : opts.sort === "most-scrutinized"
        ? "(review_count + 2 * replication_count + endorsement_count) DESC, updated_at DESC"
        : opts.collection
          ? "selected_at DESC"
          : "updated_at DESC";

  const rows = await all<ContributionRow & { title: string; abstract: string; authors: string; license: License; artifacts: string; source: string | null; review_count: number; replication_count: number; endorsement_count: number }>(
    `SELECT * FROM (
     SELECT c.*, u.handle AS owner_handle, u.display_name AS owner_name, i.handle AS importer_handle,
       v.title, v.abstract, v.authors, v.license, v.artifacts, v.source${opts.collection ? ", ci.decided_at AS selected_at" : ""},
       (SELECT COUNT(*) FROM reviews r WHERE r.contribution_id = c.id AND r.hidden = 0) AS review_count,
       (SELECT COUNT(*) FROM contributions x WHERE x.replication_of = c.id) AS replication_count,
       (SELECT COUNT(*) FROM endorsements e WHERE e.contribution_id = c.id) AS endorsement_count
     FROM contributions c
     LEFT JOIN users u ON u.id = c.owner_id
     LEFT JOIN users i ON i.id = c.imported_by
     JOIN versions v ON v.contribution_id = c.id AND v.number = c.latest_version
     ${join}
     WHERE ${where.join(" AND ")}
     ) f
     ORDER BY ${order}
     LIMIT ${Math.min(opts.limit ?? 50, 200)}`,
    ...params,
  );
  const [selected, scrutinies] = await Promise.all([
    selectionsFor(rows.map((r) => r.id)),
    Promise.all(rows.map((r) => scrutinyFor(r.id, JSON.parse(r.artifacts) as Artifact[], r.latest_version))),
  ]);
  return rows.map(
    (r, i): FeedItem => ({
      ...r,
      authors: JSON.parse(r.authors),
      source: r.source ? JSON.parse(r.source) : null,
      scrutiny: scrutinies[i],
      collections: selected.get(r.id) ?? [],
    }),
  );
}

export function getUserByHandle(handle: string) {
  return get<{ id: string; handle: string; display_name: string; bio: string; affiliation: string; orcid: string | null; orcid_verified_at: string | null; created_at: string }>(
    "SELECT id, handle, display_name, bio, affiliation, orcid, orcid_verified_at, created_at FROM users WHERE lower(handle) = lower(?::text)",
    handle,
  );
}

/** A reviewer's public record. Titles are of the version that was reviewed. */
export function reviewsBy(userId: string) {
  return all<{
    id: string; contribution_id: string; version_number: number; recommendation: Recommendation; created_at: string;
    title: string; helpful: number; doi: string | null; doi_status: string | null; ledger_hash: string | null; imported: number;
  }>(
    `SELECT r.id, r.contribution_id, r.version_number, r.recommendation, r.created_at, v.title, r.doi, r.doi_status,
       l.content_hash AS ledger_hash, c.source_kind IS NOT NULL AS imported,
       (SELECT COUNT(*) FROM review_votes x WHERE x.review_id = r.id) AS helpful
     FROM reviews r
     JOIN contributions c ON c.id = r.contribution_id
     JOIN versions v ON v.contribution_id = c.id AND v.number = r.version_number
     LEFT JOIN review_ledger l ON l.review_id = r.id
     WHERE r.reviewer_id = ? AND r.hidden = 0 AND c.status <> 'hidden' ORDER BY r.created_at DESC`,
    userId,
  );
}

export function topContributors(limit = 10) {
  return all<{ handle: string; display_name: string; rep: number }>(
    `SELECT u.handle, u.display_name, ROUND(SUM(e.points)::numeric, 0) AS rep
     FROM reputation_events e JOIN users u ON u.id = e.user_id
     GROUP BY u.id ORDER BY rep DESC LIMIT ?`,
    limit,
  );
}

export async function platformStats() {
  return (await get<{ contributions: number; versions: number; reviews: number; replications: number; people: number }>(
    `SELECT
       (SELECT COUNT(*) FROM contributions WHERE status <> 'hidden') AS contributions,
       (SELECT COUNT(*) FROM versions) AS versions,
       (SELECT COUNT(*) FROM reviews WHERE hidden = 0) AS reviews,
       (SELECT COUNT(*) FROM contributions WHERE type = 'replication' AND status <> 'hidden') AS replications,
       (SELECT COUNT(*) FROM users) AS people`,
  ))!;
}

export { reputationOf };
