import "server-only";
import { all, get, run, tx, now } from "../db";
import { shortId } from "../ids";
import { canonicalJson, sha256 } from "../hash";
import { isModerator } from "../moderation";
import {
  INDICATORS,
  MIN_ARTICLES_FOR_RATES,
  MIN_SAMPLE,
  SHARED,
  computeIndicators,
  pooled,
  type ArticleData,
  type DataClass,
  type IndicatorKey,
  type Indicators,
  type Proportion,
} from "./method";

/**
 * The Journal Integrity Index: storage, publication and the public correction process.
 * Nothing is public until FJOURNAL_INDEX_PUBLIC=1 — the method should be reviewed by research-integrity
 * researchers (and the publication checked by a lawyer) first. Moderators can always preview.
 */

export class IndexError extends Error {}
const fail = (m: string): never => {
  throw new IndexError(m);
};

export const indexPublic = () => process.env.FJOURNAL_INDEX_PUBLIC === "1";
export const canViewIndex = async (u: { id: string } | null) => indexPublic() || (await isModerator(u));

export type Journal = { issn: string; title: string; publisher: string; issns: string[]; field: string };
export type Assessment = {
  id: string; issn: string; method_version: string; window_from: string; window_until: string; sample_target: number;
  total_articles: number; retracted: number; concerns: number; retraction_days: number[]; status: "draft" | "published" | "superseded" | "withdrawn";
  notes: string; created_by_handle: string; created_at: string; published_by_handle: string | null; published_at: string | null; published_hash: string | null;
};
export type Article = ArticleData & {
  title: string; issued: string | null; license_url: string | null; one_tailed: number;
  findings: { status: string; text: string; message: string }[]; data_excerpt: string | null; error: string | null;
};

const ASSESSMENT_SELECT = `
  SELECT a.*, c.handle AS created_by_handle, p.handle AS published_by_handle
  FROM index_assessments a JOIN users c ON c.id = a.created_by LEFT JOIN users p ON p.id = a.published_by`;
type RawAssessment = Omit<Assessment, "retraction_days"> & { retraction_days: string };
const parseAssessment = (r: RawAssessment): Assessment => ({ ...r, retraction_days: JSON.parse(r.retraction_days) });

async function articlesOf(assessmentId: string): Promise<Article[]> {
  return (await all<Omit<Article, "excluded" | "findings" | "data_class"> & { excluded: string; findings: string; data_class: DataClass | null }>(
    "SELECT * FROM index_articles WHERE assessment_id = ? ORDER BY issued DESC, doi ASC",
    assessmentId,
  )).map((r) => ({ ...r, excluded: JSON.parse(r.excluded), findings: JSON.parse(r.findings) }));
}

const journalOf = async (issn: string): Promise<Journal | undefined> => {
  const j = await get<Omit<Journal, "issns"> & { issns: string }>("SELECT issn, title, publisher, issns, field FROM index_journals WHERE issn = ?", issn);
  return j && { ...j, issns: JSON.parse(j.issns) };
};

/** The assessment shown for a journal: its latest published one (or, for previews, the latest of any status but withdrawn). */
async function currentAssessment(issn: string, preview: boolean): Promise<Assessment | undefined> {
  const r = await get<RawAssessment>(
    `${ASSESSMENT_SELECT} WHERE a.issn = ? AND a.status ${preview ? "IN ('published','draft')" : "= 'published'"}
     ORDER BY a.status = 'published' DESC, a.created_at DESC LIMIT 1`,
    issn,
  );
  return r && parseAssessment(r);
}

// ───────────────────────────── Baselines ─────────────────────────────

type Counts = { statistics: { k: number; n: number }; data: { k: number; n: number }; license: { k: number; n: number }; retractions: { k: number; n: number } };
const countsOf = (i: Indicators, a: Assessment): Counts => ({
  statistics: { k: i.statistics.gross.k, n: i.statistics.gross.n },
  data: { k: i.data.shared.k, n: i.data.shared.n },
  license: { k: i.license.cc.k, n: i.license.cc.n },
  retractions: { k: a.retracted, n: a.total_articles },
});

export type Baselines = Record<IndicatorKey, Proportion | null> & { journals: number };

/** Pooled across every journal in the field with a published assessment (the journal itself included). */
export async function fieldBaselines(field: string): Promise<Baselines> {
  const journals = await all<{ issn: string }>("SELECT issn FROM index_journals WHERE field = ?", field);
  const assessments = (await Promise.all(journals.map((j) => currentAssessment(j.issn, false)))).filter((a): a is Assessment => !!a);
  const parts = await Promise.all(assessments.map(async (a) => countsOf(computeIndicators(await articlesOf(a.id), a), a)));
  const sampleMin = (k: Exclude<IndicatorKey, "retractions">) => pooled(parts.filter((p) => p[k].n > 0).map((p) => p[k]), MIN_SAMPLE);
  return {
    journals: parts.length,
    statistics: sampleMin("statistics"),
    data: sampleMin("data"),
    license: sampleMin("license"),
    retractions: pooled(parts.map((p) => p.retractions), MIN_ARTICLES_FOR_RATES),
  };
}

// ───────────────────────────── Reads ─────────────────────────────

export async function listIndex(preview: boolean) {
  const journals = await all<{ issn: string }>("SELECT issn FROM index_journals ORDER BY lower(title)");
  const rows = await Promise.all(
    journals.map(async (j) => {
      const [journal, a] = await Promise.all([journalOf(j.issn), currentAssessment(j.issn, preview)]);
      return a ? { journal: journal!, assessment: a, indicators: computeIndicators(await articlesOf(a.id), a) } : null;
    }),
  );
  return rows.filter((x): x is NonNullable<typeof x> => !!x);
}

export async function journalPage(issn: string, preview: boolean) {
  const journal = await journalOf(issn);
  if (!journal) return null;
  const assessment = await currentAssessment(issn, preview);
  if (!assessment) return null;
  const articles = await articlesOf(assessment.id);
  const history = (await all<RawAssessment>(
    `${ASSESSMENT_SELECT} WHERE a.issn = ? AND a.status ${preview ? "<> ''" : "IN ('published','superseded','withdrawn')"} ORDER BY a.created_at DESC`,
    issn,
  )).map(parseAssessment);
  const replies = await all<{ id: string; role: string; body: string; status: string; handle: string; display_name: string; reviewed_by_handle: string | null; review_note: string | null; created_at: string; reviewed_at: string | null }>(
    `SELECT r.id, r.role, r.body, r.status, u.handle, u.display_name, m.handle AS reviewed_by_handle, r.review_note, r.created_at, r.reviewed_at
     FROM index_replies r JOIN users u ON u.id = r.author_id LEFT JOIN users m ON m.id = r.reviewed_by
     WHERE r.issn = ? AND r.status ${preview ? "<> ''" : "= 'published'"} ORDER BY r.created_at ASC`,
    issn,
  );
  const corrections = await all<{ id: string; doi: string | null; indicator: string; claim: string; evidence_url: string; status: string; resolution: string | null; requester_handle: string; resolver_handle: string | null; created_at: string; resolved_at: string | null }>(
    `SELECT c.id, c.doi, c.indicator, c.claim, c.evidence_url, c.status, c.resolution, q.handle AS requester_handle, r.handle AS resolver_handle, c.created_at, c.resolved_at
     FROM index_corrections c JOIN users q ON q.id = c.requester_id LEFT JOIN users r ON r.id = c.resolver_id
     WHERE c.assessment_id = ? ORDER BY c.created_at DESC`,
    assessment.id,
  );
  // What the community found on Fjournal itself, about this journal's articles that were opened for review here.
  const onFjournal = (await get<{ works: number; reviews: number; reproduced: number; partial: number; failed: number }>(
    `SELECT COUNT(DISTINCT c.id) AS works,
       (SELECT COUNT(*) FROM reviews r WHERE r.hidden = 0 AND r.contribution_id IN (
          SELECT c2.id FROM contributions c2 JOIN versions v2 ON v2.contribution_id = c2.id AND v2.number = c2.latest_version
          WHERE c2.source_kind = 'doi' AND lower(v2.source::jsonb ->> 'venue') = lower(?::text))) AS reviews,
       (SELECT COUNT(*) FROM contributions x WHERE x.replication_outcome = 'reproduced' AND x.status = 'active' AND x.replication_of IN (
          SELECT c2.id FROM contributions c2 JOIN versions v2 ON v2.contribution_id = c2.id AND v2.number = c2.latest_version
          WHERE c2.source_kind = 'doi' AND lower(v2.source::jsonb ->> 'venue') = lower(?::text))) AS reproduced,
       (SELECT COUNT(*) FROM contributions x WHERE x.replication_outcome = 'partial' AND x.status = 'active' AND x.replication_of IN (
          SELECT c2.id FROM contributions c2 JOIN versions v2 ON v2.contribution_id = c2.id AND v2.number = c2.latest_version
          WHERE c2.source_kind = 'doi' AND lower(v2.source::jsonb ->> 'venue') = lower(?::text))) AS partial,
       (SELECT COUNT(*) FROM contributions x WHERE x.replication_outcome = 'failed' AND x.status = 'active' AND x.replication_of IN (
          SELECT c2.id FROM contributions c2 JOIN versions v2 ON v2.contribution_id = c2.id AND v2.number = c2.latest_version
          WHERE c2.source_kind = 'doi' AND lower(v2.source::jsonb ->> 'venue') = lower(?::text))) AS failed
     FROM contributions c JOIN versions v ON v.contribution_id = c.id AND v.number = c.latest_version
     WHERE c.source_kind = 'doi' AND c.status <> 'hidden' AND lower(v.source::jsonb ->> 'venue') = lower(?::text)`,
    journal.title, journal.title, journal.title, journal.title, journal.title,
  ))!;
  const [baselines, currentHash] = await Promise.all([
    fieldBaselines(journal.field),
    assessment.published_hash ? assessmentHash(assessment.id) : Promise.resolve(null),
  ]);
  return {
    journal,
    assessment,
    articles,
    indicators: computeIndicators(articles, assessment),
    baselines,
    history,
    replies,
    corrections,
    onFjournal,
    hashOk: assessment.published_hash ? assessment.published_hash === currentHash : null,
  };
}

/** What a published assessment commits to: its journal-level figures and every article measurement as published. */
export async function assessmentHash(id: string): Promise<string> {
  const a = await get<Record<string, unknown>>(
    `SELECT id, issn, method_version, window_from, window_until, sample_target, total_articles, retracted, concerns, retraction_days, created_at
     FROM index_assessments WHERE id = ?`,
    id,
  );
  const arts = await all<Record<string, unknown>>(
    `SELECT doi, issued, license_url, cc_license, fulltext, tests, inconsistent, gross, one_tailed, findings, data_class, data_excerpt, error
     FROM index_articles WHERE assessment_id = ? ORDER BY doi`,
    id,
  );
  return sha256(canonicalJson({ assessment: { ...a }, articles: arts.map((r) => ({ ...r })) }));
}

export async function drafts() {
  return (await all<RawAssessment & { title: string }>(
    `${ASSESSMENT_SELECT.replace("SELECT a.*,", "SELECT a.*, j.title,")} JOIN index_journals j ON j.issn = a.issn WHERE a.status = 'draft' ORDER BY a.created_at DESC`,
  )).map((r) => ({ ...parseAssessment(r), title: r.title }));
}

export function pendingReplies() {
  return all<{ id: string; issn: string; title: string; role: string; body: string; handle: string; created_at: string }>(
    `SELECT r.id, r.issn, j.title, r.role, r.body, u.handle, r.created_at FROM index_replies r
     JOIN index_journals j ON j.issn = r.issn JOIN users u ON u.id = r.author_id WHERE r.status = 'pending' ORDER BY r.created_at ASC`,
  );
}

export function openCorrections() {
  return all<{ id: string; assessment_id: string; issn: string; title: string; doi: string | null; indicator: string; claim: string; evidence_url: string; handle: string; created_at: string }>(
    `SELECT c.id, c.assessment_id, a.issn, j.title, c.doi, c.indicator, c.claim, c.evidence_url, u.handle, c.created_at
     FROM index_corrections c JOIN index_assessments a ON a.id = c.assessment_id JOIN index_journals j ON j.issn = a.issn
     JOIN users u ON u.id = c.requester_id WHERE c.status = 'open' ORDER BY c.created_at ASC`,
  );
}

// ───────────────────────────── Publication (four eyes) ─────────────────────────────

const requireMod = async (u: { id: string }) => {
  if (!(await isModerator(u))) fail("Only moderators can do that.");
};

export async function publishAssessment(mod: { id: string }, id: string) {
  await requireMod(mod);
  await tx(async () => {
    const a = (await get<{ issn: string; status: string; created_by: string }>("SELECT issn, status, created_by FROM index_assessments WHERE id = ?", id)) ?? fail("Assessment not found.");
    if (a!.status !== "draft") fail("Only drafts can be published.");
    if (a!.created_by === mod.id) fail("Someone other than the moderator who ran the sweep must check and publish it.");
    const ts = now();
    await run("UPDATE index_assessments SET status = 'superseded' WHERE issn = ? AND status = 'published'", a!.issn);
    await run("UPDATE index_assessments SET status = 'published', published_by = ?, published_at = ?, published_hash = ? WHERE id = ?", mod.id, ts, await assessmentHash(id), id);
  });
}

export async function withdrawAssessment(mod: { id: string }, id: string, reason: string) {
  await requireMod(mod);
  if (reason.trim().length < 20) fail("Explain publicly why it's withdrawn (at least 20 characters).");
  const a = (await get<{ status: string }>("SELECT status FROM index_assessments WHERE id = ?", id)) ?? fail("Assessment not found.");
  if (a!.status === "withdrawn") fail("Already withdrawn.");
  await run("UPDATE index_assessments SET status = 'withdrawn', notes = ? WHERE id = ?", `Withdrawn ${now().slice(0, 10)}: ${reason.trim().slice(0, 2000)}`, id);
}

// ───────────────────────────── Right of reply ─────────────────────────────

export async function submitReply(user: { id: string }, issn: string, role: string, body: string) {
  if (!(await get("SELECT 1 FROM index_journals WHERE issn = ?", issn))) fail("Journal not found.");
  if (role.trim().length < 3 || role.trim().length > 120) fail("Say who you are for the journal (e.g. Editor-in-chief, Research integrity officer).");
  if (body.trim().length < 50 || body.trim().length > 5000) fail("Replies are 50–5000 characters.");
  if ((await get<{ n: number }>("SELECT COUNT(*) AS n FROM index_replies WHERE author_id = ? AND status = 'pending'", user.id))!.n >= 3)
    fail("You have replies waiting for identity checks already.");
  await run(
    "INSERT INTO index_replies (id, issn, author_id, role, body, created_at) VALUES (?,?,?,?,?,?)",
    `ir_${shortId(10)}`, issn, user.id, role.trim(), body.trim(), now(),
  );
}

/** A moderator confirms (out of band) that the author speaks for the journal; the reply is then published verbatim. */
export async function reviewReply(mod: { id: string }, id: string, publish: boolean, note: string) {
  await requireMod(mod);
  const r = (await get<{ status: string; author_id: string }>("SELECT status, author_id FROM index_replies WHERE id = ?", id)) ?? fail("Reply not found.");
  if (r!.status !== "pending") fail("Already reviewed.");
  if (r!.author_id === mod.id) fail("Another moderator has to review your own reply.");
  if (note.trim().length < 10) fail("Record how identity was checked, or why the reply is rejected (at least 10 characters).");
  await run("UPDATE index_replies SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = ? WHERE id = ?", publish ? "published" : "rejected", mod.id, note.trim().slice(0, 1000), now(), id);
}

// ───────────────────────────── Public corrections ─────────────────────────────

export const CORRECTABLE: (IndicatorKey | "other")[] = ["statistics", "data", "license", "retractions", "other"];
const SAMPLE_BASED: IndicatorKey[] = ["statistics", "data", "license"];

export async function requestCorrection(user: { id: string }, assessmentId: string, doi: string | null, indicator: string, claim: string, evidence: string) {
  const a = (await get<{ status: string }>("SELECT status FROM index_assessments WHERE id = ?", assessmentId)) ?? fail("Assessment not found.");
  if (a!.status === "withdrawn") fail("This assessment was withdrawn.");
  if (!CORRECTABLE.includes(indicator as IndicatorKey)) fail("Choose what the correction is about.");
  if (doi && !(await get("SELECT 1 FROM index_articles WHERE assessment_id = ? AND doi = ?", assessmentId, doi.toLowerCase()))) fail("That article isn't in this assessment's sample.");
  if (claim.trim().length < 30) fail("Explain what is wrong and why (at least 30 characters).");
  if (evidence.trim() && !/^https?:\/\//i.test(evidence.trim())) fail("Evidence must be a link.");
  const since = new Date(Date.now() - 86400_000).toISOString();
  if ((await get<{ n: number }>("SELECT COUNT(*) AS n FROM index_corrections WHERE requester_id = ? AND created_at > ?", user.id, since))!.n >= 10)
    fail("At most 10 correction requests a day.");
  await run(
    "INSERT INTO index_corrections (id, assessment_id, doi, indicator, claim, evidence_url, requester_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
    `ic_${shortId(10)}`, assessmentId, doi ? doi.toLowerCase() : null, indicator, claim.trim().slice(0, 5000), evidence.trim().slice(0, 1000), user.id, now(),
  );
}

/**
 * Accepting an article-level correction removes that article from the indicator, which changes the
 * published figure immediately; the correction and its resolution stay listed on the journal's page.
 */
export async function resolveCorrection(mod: { id: string }, id: string, accept: boolean, resolution: string) {
  await requireMod(mod);
  await tx(async () => {
    const c = (await get<{ status: string; assessment_id: string; doi: string | null; indicator: string; requester_id: string }>(
      "SELECT status, assessment_id, doi, indicator, requester_id FROM index_corrections WHERE id = ?",
      id,
    )) ?? fail("Correction not found.");
    if (c!.status !== "open") fail("Already resolved.");
    if (c!.requester_id === mod.id) fail("Another moderator has to resolve your own request.");
    if (resolution.trim().length < 20) fail("Explain the resolution publicly (at least 20 characters).");
    if (accept && c!.doi && SAMPLE_BASED.includes(c!.indicator as IndicatorKey)) {
      const art = (await get<{ excluded: string }>("SELECT excluded FROM index_articles WHERE assessment_id = ? AND doi = ?", c!.assessment_id, c!.doi))!;
      const excluded = new Set<string>(JSON.parse(art.excluded));
      excluded.add(c!.indicator);
      await run("UPDATE index_articles SET excluded = ? WHERE assessment_id = ? AND doi = ?", JSON.stringify([...excluded]), c!.assessment_id, c!.doi);
    }
    await run(
      "UPDATE index_corrections SET status = ?, resolution = ?, resolver_id = ?, resolved_at = ? WHERE id = ?",
      accept ? "accepted" : "rejected", resolution.trim().slice(0, 5000), mod.id, now(), id,
    );
  });
}

export { INDICATORS, SHARED };
