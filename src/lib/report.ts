import "server-only";
import { all, get, run, tx, now } from "./db";
import { shortId } from "./ids";
import { canonicalJson, sha256 } from "./hash";
import { verifyLedger } from "./ledger";
import { isAuthorOf } from "./authors";
import { scrutinyFor } from "./queries";
import { selectionsFor, boardServiceOf } from "./collections";
import { checksFor, worst, type CheckStatus } from "./integrity/run";
import { computationallyReproduced } from "./repro/runs";
import { CONTRIBUTION_TYPES, MODERATION_REASONS, type ContributionType, type ModerationReason, type Recommendation, type ReplicationOutcome, type SourceRecord } from "./constants";
import type { Artifact } from "./ledger";

/**
 * A researcher's scrutiny report: one page a hiring or funding committee can actually use. It reports
 * how the work held up under open scrutiny — reviews, replications (including failed ones), open data
 * and code, re-run code, integrity checks, responsiveness to review — plus the reviewing and editorial
 * service the person gave. Deliberately absent: journal names as a quality signal, impact factors,
 * citation counts, h-indices, affiliation prestige, and any single score (DORA, CoARA).
 * Everything in it is already public; the report only gathers it.
 */

export class ReportError extends Error {}
const fail = (m: string): never => {
  throw new ReportError(m);
};

export const PERIODS = [3, 5, 10] as const;
export const MAX_HIGHLIGHTS = 5;
export const MAX_STATEMENT = 800; // about six printed lines: the evidence has to fit on the same page
const FREEZES_PER_DAY = 20;

export type WorkEvidence = {
  id: string;
  title: string;
  type: ContributionType;
  published_here: boolean;
  venue: string | null; // only to identify a work published elsewhere; never scored
  first_published: string;
  versions: number;
  status: "active" | "retracted";
  reviews: number;
  reviewers: number;
  soundness: number | null; // reputation-weighted, 1–5
  reproducibility: number | null;
  recommendations: Record<Recommendation, number>;
  replications: Record<ReplicationOutcome, number>;
  endorsements: number;
  has_data: boolean;
  has_code: boolean;
  computationally_reproduced: boolean;
  checks: CheckStatus | null; // worst automated integrity check on the latest version
  revised_after_review: boolean; // a new version followed public review (works published here)
  collections: string[]; // names of collections whose boards selected it
};

export type ReportData = {
  kind: "fjournal.scrutiny-report/v1";
  researcher: { handle: string; name: string; affiliation: string; orcid: string | null; member_since: string };
  period: { years: number | null; from: string | null; to: string };
  statement: string; // written by the researcher
  highlights: { chosen_by: "researcher" | "automatic"; works: WorkEvidence[] };
  works: {
    total: number;
    by_type: Partial<Record<ContributionType, number>>;
    published_here: number;
    published_elsewhere: number; // imported works whose authorship was verified through ORCID
    open: number; // data + code
    computationally_reproduced: number;
    reviewed: number; // at least one public review
    revised_after_review: number;
    replicated: number; // at least one independent "reproduced"
    failed_replication: number; // at least one independent "failed"
    selected_by_collections: number;
  };
  replications_performed: { id: string; title: string; of_id: string; of_title: string; outcome: ReplicationOutcome | null }[];
  reviewing: {
    reviews: number;
    works: number;
    helpful_votes: number;
    with_doi: number;
    of_work_published_elsewhere: number;
    recommendations: Record<Recommendation, number>;
    most_helpful: { id: string; title: string; helpful: number; doi: string | null; created_at: string }[];
  };
  editorial: { collection: string; slug: string; role: string; current: boolean; decisions: number }[];
  integrity: {
    retracted: { id: string; title: string; reason: string; log_seq: number | null }[];
    removed_by_moderation: number; // works, reviews and comments
  };
  ledger: { verified: boolean; version_head: string; review_head: string; collection_head: string };
  generated_at: string;
};

const ZERO_RECS = (): Record<Recommendation, number> => ({ sound: 0, minor_issues: 0, major_issues: 0, unsound: 0 });

async function evidenceFor(id: string): Promise<WorkEvidence | null> {
  const c = await get<{
    id: string; type: ContributionType; status: string; latest_version: number; source_kind: string | null; owner_id: string | null;
    title: string; artifacts: string; source: string | null; seq: number; first: string;
  }>(
    `SELECT c.id, c.type, c.status, c.latest_version, c.source_kind, c.owner_id, v.title, v.artifacts, v.source, v.seq,
       (SELECT MIN(created_at) FROM versions WHERE contribution_id = c.id) AS first
     FROM contributions c JOIN versions v ON v.contribution_id = c.id AND v.number = c.latest_version WHERE c.id = ?`,
    id,
  );
  if (!c || c.status === "hidden") return null;
  const artifacts: Artifact[] = JSON.parse(c.artifacts);
  const [s, recRows, first, checks, computed, selected] = await Promise.all([
    scrutinyFor(id, artifacts, c.latest_version),
    all<{ recommendation: Recommendation; n: number }>(
      "SELECT recommendation, COUNT(*) AS n FROM reviews WHERE contribution_id = ? AND hidden = 0 GROUP BY recommendation",
      id,
    ),
    get<{ t: string | null }>("SELECT MIN(created_at) AS t FROM reviews WHERE contribution_id = ? AND hidden = 0", id),
    checksFor(c.seq),
    computationallyReproduced(id),
    selectionsFor([id]),
  ]);
  const recommendations = ZERO_RECS();
  for (const r of recRows) recommendations[r.recommendation] = r.n;
  const firstReview = first?.t;
  const revised = !c.source_kind && !!firstReview && !!(await get("SELECT 1 FROM versions WHERE contribution_id = ? AND created_at > ?", id, firstReview));
  const source: SourceRecord | null = c.source ? JSON.parse(c.source) : null;
  return {
    id,
    title: c.title,
    type: c.type,
    published_here: !c.source_kind,
    venue: source ? source.venue || null : null,
    first_published: source?.published ?? c.first.slice(0, 10),
    versions: c.latest_version,
    status: c.status === "retracted" ? "retracted" : "active",
    reviews: s.reviewCount,
    reviewers: s.distinctReviewers,
    soundness: s.soundness === null ? null : Math.round(s.soundness * 100) / 100,
    reproducibility: s.reproducibility === null ? null : Math.round(s.reproducibility * 100) / 100,
    recommendations,
    replications: { reproduced: s.reproduced, partial: s.partial, failed: s.failed },
    endorsements: s.endorsements,
    has_data: s.hasData,
    has_code: s.hasCode,
    computationally_reproduced: computed,
    checks: checks.length ? worst(checks.map((k) => k.status)) : null,
    revised_after_review: revised,
    collections: (selected.get(id) ?? []).map((x) => x.name),
  };
}

/** Works a person can be judged on: what they published here, and imported work they proved they wrote. */
async function worksOf(userId: string) {
  return (await all<{ id: string }>(
    `SELECT c.id FROM contributions c
     WHERE (c.owner_id = ? OR c.id IN (SELECT contribution_id FROM contribution_authors WHERE user_id = ?)) AND c.status <> 'hidden'
     ORDER BY c.created_at DESC`,
    userId, userId,
  )).map((r) => r.id);
}

/** "2015", "2015-06" or "2015-06-01" → a comparable ISO day. Imported works count from when they were published, not imported. */
const isoDay = (d: string) => (d.length === 4 ? `${d}-01-01` : d.length === 7 ? `${d}-01` : d.slice(0, 10));

const parseHighlights = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_HIGHLIGHTS) : [];
  } catch {
    return [];
  }
};

const ledgerHead = async (table: string) =>
  (await get<{ h: string }>(`SELECT chain_hash AS h FROM ${table} ORDER BY seq DESC LIMIT 1`))?.h ?? "0".repeat(64);

export async function buildReport(handle: string, years: number | null): Promise<ReportData | null> {
  const u = await get<{ id: string; handle: string; display_name: string; affiliation: string; orcid: string | null; orcid_verified_at: string | null; created_at: string; report_statement: string; report_highlights: string }>(
    "SELECT id, handle, display_name, affiliation, orcid, orcid_verified_at, created_at, report_statement, report_highlights FROM users WHERE lower(handle) = lower(?::text)",
    handle,
  );
  if (!u) return null;
  const to = now();
  const from = years ? new Date(Date.now() - years * 365.25 * 86400_000).toISOString() : null;
  const inPeriod = (t: string) => !from || t >= from;

  const works = (await Promise.all((await worksOf(u.id)).map(evidenceFor)))
    .filter((w): w is WorkEvidence => !!w && (!from || isoDay(w.first_published) >= from.slice(0, 10)));
  const by_type: Partial<Record<ContributionType, number>> = {};
  for (const w of works) by_type[w.type] = (by_type[w.type] ?? 0) + 1;

  // Highlights: the researcher's own choice (whatever the period), else the most scrutinized works.
  const chosenIds: string[] = [];
  for (const id of parseHighlights(u.report_highlights)) if (await isAuthorOf(u.id, id)) chosenIds.push(id);
  const chosen = (await Promise.all(chosenIds.map(evidenceFor))).filter((w): w is WorkEvidence => !!w);
  const auto = [...works]
    .sort((a, b) => b.reviews + 2 * (b.replications.reproduced + b.replications.partial + b.replications.failed) + b.endorsements -
      (a.reviews + 2 * (a.replications.reproduced + a.replications.partial + a.replications.failed) + a.endorsements))
    .slice(0, 3);

  const replications_performed = (await all<{ id: string; title: string; of_id: string; of_title: string; outcome: ReplicationOutcome | null; created_at: string }>(
    `SELECT c.id, v.title, t.id AS of_id, tv.title AS of_title, c.replication_outcome AS outcome, c.created_at
     FROM contributions c JOIN versions v ON v.contribution_id = c.id AND v.number = c.latest_version
     JOIN contributions t ON t.id = c.replication_of JOIN versions tv ON tv.contribution_id = t.id AND tv.number = t.latest_version
     WHERE c.owner_id = ? AND c.type = 'replication' AND c.status <> 'hidden' AND t.status <> 'hidden' ORDER BY c.created_at DESC`,
    u.id,
  ))
    .filter((r) => inPeriod(r.created_at))
    .map((r) => ({ id: r.id, title: r.title, of_id: r.of_id, of_title: r.of_title, outcome: r.outcome }));

  const reviews = (await all<{ id: string; contribution_id: string; title: string; recommendation: Recommendation; helpful: number; doi: string | null; doi_status: string | null; imported: number; created_at: string }>(
    `SELECT r.id, r.contribution_id, v.title, r.recommendation, r.doi, r.doi_status, r.created_at, c.source_kind IS NOT NULL AS imported,
       (SELECT COUNT(*) FROM review_votes x WHERE x.review_id = r.id) AS helpful
     FROM reviews r JOIN contributions c ON c.id = r.contribution_id
     JOIN versions v ON v.contribution_id = c.id AND v.number = r.version_number
     WHERE r.reviewer_id = ? AND r.hidden = 0 AND c.status <> 'hidden'`,
    u.id,
  )).filter((r) => inPeriod(r.created_at));
  const recs = ZERO_RECS();
  for (const r of reviews) recs[r.recommendation]++;

  const decisionsSince = async (slug: string) =>
    (await get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM collection_log l JOIN collections co ON co.id = l.collection_id
       WHERE co.slug = ? AND l.actor_id = ? AND l.kind IN ('selected','declined') AND (?::text IS NULL OR l.created_at >= ?::text)`,
      slug, u.id, from, from,
    ))!.n;

  const retracted = await all<{ id: string; title: string; reason: ModerationReason | null; log_seq: number | null }>(
    `SELECT c.id, v.title,
       (SELECT reason FROM moderation_actions m WHERE m.target_id = c.id AND m.action = 'retract' ORDER BY m.seq DESC LIMIT 1) AS reason,
       (SELECT seq FROM moderation_actions m WHERE m.target_id = c.id AND m.action = 'retract' ORDER BY m.seq DESC LIMIT 1) AS log_seq
     FROM contributions c JOIN versions v ON v.contribution_id = c.id AND v.number = c.latest_version
     WHERE c.owner_id = ? AND c.status = 'retracted'`,
    u.id,
  );
  const removed = (await get<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM contributions WHERE owner_id = ? AND status = 'hidden')
          + (SELECT COUNT(*) FROM reviews WHERE reviewer_id = ? AND hidden = 1)
          + (SELECT COUNT(*) FROM comments WHERE author_id = ? AND hidden = 1) AS n`,
    u.id, u.id, u.id,
  ))!.n;
  const editorial = await Promise.all(
    (await boardServiceOf(u.id)).map(async (s) => ({
      collection: s.name, slug: s.slug, role: s.role, current: s.status === "active", decisions: await decisionsSince(s.slug),
    })),
  );
  const [verified, version_head, review_head, collection_head] = await Promise.all([
    verifyLedger().then((v) => v.ok),
    ledgerHead("versions"),
    ledgerHead("review_ledger"),
    ledgerHead("collection_log"),
  ]);

  return {
    kind: "fjournal.scrutiny-report/v1",
    researcher: {
      handle: u.handle,
      name: u.display_name,
      affiliation: u.affiliation,
      orcid: u.orcid_verified_at ? u.orcid : null,
      member_since: u.created_at,
    },
    period: { years, from, to },
    statement: u.report_statement,
    highlights: chosen.length ? { chosen_by: "researcher", works: chosen } : { chosen_by: "automatic", works: auto },
    works: {
      total: works.length,
      by_type,
      published_here: works.filter((w) => w.published_here).length,
      published_elsewhere: works.filter((w) => !w.published_here).length,
      open: works.filter((w) => w.has_data && w.has_code).length,
      computationally_reproduced: works.filter((w) => w.computationally_reproduced).length,
      reviewed: works.filter((w) => w.reviews > 0).length,
      revised_after_review: works.filter((w) => w.revised_after_review).length,
      replicated: works.filter((w) => w.replications.reproduced > 0).length,
      failed_replication: works.filter((w) => w.replications.failed > 0).length,
      selected_by_collections: works.filter((w) => w.collections.length > 0).length,
    },
    replications_performed,
    reviewing: {
      reviews: reviews.length,
      works: new Set(reviews.map((r) => r.contribution_id)).size,
      helpful_votes: reviews.reduce((s, r) => s + r.helpful, 0),
      with_doi: reviews.filter((r) => r.doi_status === "registered").length,
      of_work_published_elsewhere: reviews.filter((r) => r.imported).length,
      recommendations: recs,
      most_helpful: [...reviews]
        .sort((a, b) => b.helpful - a.helpful || b.created_at.localeCompare(a.created_at))
        .slice(0, 3)
        .map((r) => ({ id: r.id, title: r.title, helpful: r.helpful, doi: r.doi_status === "registered" ? r.doi : null, created_at: r.created_at })),
    },
    editorial,
    integrity: {
      retracted: retracted.map((r) => ({ ...r, reason: r.reason ? MODERATION_REASONS[r.reason].label : "retracted" })),
      removed_by_moderation: removed,
    },
    ledger: { verified, version_head, review_head, collection_head },
    generated_at: to,
  };
}

export const reportHash = (d: ReportData) => sha256(canonicalJson(d));

export const typeLabel = (t: ContributionType) => CONTRIBUTION_TYPES[t].label;

// ───────────────────────────── Researcher's own settings ─────────────────────────────

export async function reportSettingsOf(userId: string) {
  const u = await get<{ report_statement: string; report_highlights: string }>("SELECT report_statement, report_highlights FROM users WHERE id = ?", userId);
  return { statement: u?.report_statement ?? "", highlights: parseHighlights(u?.report_highlights ?? "[]") };
}

/** Works a researcher may highlight: their own, and imported works they verified. */
export function highlightableWorks(userId: string) {
  return all<{ id: string; title: string; type: ContributionType }>(
    `SELECT c.id, v.title, c.type FROM contributions c JOIN versions v ON v.contribution_id = c.id AND v.number = c.latest_version
     WHERE (c.owner_id = ? OR c.id IN (SELECT contribution_id FROM contribution_authors WHERE user_id = ?)) AND c.status <> 'hidden'
     ORDER BY c.created_at DESC`,
    userId, userId,
  );
}

export async function saveReportSettings(userId: string, statement: string, highlights: string[]) {
  const text = statement.trim();
  if (text.length > MAX_STATEMENT) fail(`Keep the statement under ${MAX_STATEMENT} characters: it has to fit on one page with the evidence.`);
  const ids = [...new Set(highlights.map((h) => h.trim()).filter(Boolean))];
  if (ids.length > MAX_HIGHLIGHTS) fail(`Choose at most ${MAX_HIGHLIGHTS} works to highlight.`);
  for (const id of ids)
    if (!(await isAuthorOf(userId, id)) || (await get("SELECT 1 FROM contributions WHERE id = ? AND status = 'hidden'", id)))
      fail("You can only highlight your own work.");
  await run("UPDATE users SET report_statement = ?, report_highlights = ? WHERE id = ?", text, JSON.stringify(ids), userId);
}

// ───────────────────────────── Frozen reports ─────────────────────────────

/** Freezes the report as it is now, so a committee can check later that what it received is genuine. */
export async function freezeReport(handle: string, requestedBy: string, years: number | null): Promise<string> {
  return tx(async () => {
    const since = new Date(Date.now() - 86400_000).toISOString();
    if ((await get<{ n: number }>("SELECT COUNT(*) AS n FROM scrutiny_reports WHERE requested_by = ? AND created_at > ?", requestedBy, since))!.n >= FREEZES_PER_DAY)
      fail(`At most ${FREEZES_PER_DAY} frozen reports a day.`);
    const data = (await buildReport(handle, years)) ?? fail("No such researcher.");
    const userId = (await get<{ id: string }>("SELECT id FROM users WHERE lower(handle) = lower(?::text)", handle))!.id;
    const id = `rep_${shortId(10)}`;
    await run(
      "INSERT INTO scrutiny_reports (id, user_id, requested_by, years, data, content_hash, created_at) VALUES (?,?,?,?,?,?,?)",
      id, userId, requestedBy, years, JSON.stringify(data), reportHash(data), data.generated_at,
    );
    return id;
  });
}

export async function frozenReport(id: string) {
  const r = await get<{ id: string; data: string; content_hash: string; created_at: string; requested_by_handle: string; handle: string }>(
    `SELECT s.id, s.data, s.content_hash, s.created_at, q.handle AS requested_by_handle, u.handle
     FROM scrutiny_reports s JOIN users q ON q.id = s.requested_by JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    id,
  );
  if (!r) return null;
  const data = JSON.parse(r.data) as ReportData;
  return { ...r, data, intact: reportHash(data) === r.content_hash };
}
