"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { get, run, tx, now } from "@/lib/db";
import { contributionId, shortId } from "@/lib/ids";
import { appendReviewEntry, appendVersion, type Artifact, type VersionContent } from "@/lib/ledger";
import { award, weightOf } from "@/lib/reputation";
import { runIntegrityChecks } from "@/lib/integrity/run";
import { ImportError, importWork } from "@/lib/import";
import { ClaimError, claimAuthorship, isAuthorOf } from "@/lib/authors";
import { DoiError, registerReviewDoi, reserveReviewDoi } from "@/lib/doi";
import { OrcidError, validOrcid } from "@/lib/orcid";
import { unsign } from "@/lib/config";
import { ReproError, enqueueRun, reproEnabled, requestRun } from "@/lib/repro/runs";
import { cookies } from "next/headers";
import {
  CollectionError,
  createCollection,
  decide,
  deselect,
  inviteMember,
  leaveBoard,
  nominateWork,
  removeMember,
  respondToInvitation,
  setRole,
  submitWork,
  updateCollection,
  validateCollectionInput,
  withdrawWork,
  type Role,
} from "@/lib/collections";
import { PERIODS, ReportError, freezeReport, saveReportSettings } from "@/lib/report";
import {
  IndexError,
  publishAssessment,
  requestCorrection,
  resolveCorrection,
  reviewReply,
  submitReply,
  withdrawAssessment,
} from "@/lib/index/index";
import {
  ModerationError,
  dismissReport,
  fileAppeal,
  fileReport,
  isModerator,
  resolveAppeal,
  takeAction,
} from "@/lib/moderation";
import {
  createSession,
  currentUser,
  destroySession,
  hashPassword,
  newUserId,
  requireUser,
  verifyPassword,
} from "@/lib/auth";
import {
  ARTIFACT_KINDS,
  AUTHOR_LICENSES,
  CONTRIBUTION_TYPES,
  DEFAULT_LICENSE,
  RECOMMENDATIONS,
  REPLICATION_OUTCOMES,
  type ArtifactKind,
  type ContributionType,
  type Declarations,
  type ModerationTarget,
  type License,
  type Recommendation,
  type ReplicationOutcome,
} from "@/lib/constants";

export type FormState = { error?: string; ok?: string } | undefined;

class UserError extends Error {}
const fail = (msg: string): never => {
  throw new UserError(msg);
};

function str(fd: FormData, key: string, { max = 100_000, required = false } = {}): string {
  const v = String(fd.get(key) ?? "").trim();
  if (required && !v) fail(`"${key.replace(/_/g, " ")}" is required.`);
  if (v.length > max) fail(`"${key.replace(/_/g, " ")}" is too long (max ${max} characters).`);
  return v;
}

/** Turns thrown UserErrors into form state; lets redirects and real bugs propagate. */
async function guarded(fn: () => Promise<void>): Promise<FormState> {
  try {
    await fn();
  } catch (e) {
    if (
      e instanceof UserError || e instanceof ModerationError || e instanceof ImportError ||
      e instanceof ClaimError || e instanceof DoiError || e instanceof OrcidError || e instanceof ReproError ||
      e instanceof CollectionError || e instanceof ReportError || e instanceof IndexError
    )
      return { error: e.message };
    if (e instanceof Error && e.message.startsWith("You need to sign in")) return { error: e.message };
    throw e;
  }
}

// ───────────────────────────── Accounts ─────────────────────────────

export async function signup(_: FormState, fd: FormData): Promise<FormState> {
  let handle = "";
  const result = await guarded(async () => {
    handle = str(fd, "handle", { required: true, max: 32 }).toLowerCase();
    const displayName = str(fd, "display_name", { required: true, max: 80 });
    const password = String(fd.get("password") ?? "");
    const affiliation = str(fd, "affiliation", { max: 200 });
    if (!/^[a-z0-9_-]{3,32}$/.test(handle)) fail("Handle must be 3–32 characters: a–z, 0–9, _ or -.");
    if (password.length < 10) fail("Password must be at least 10 characters.");
    if (await get("SELECT 1 FROM users WHERE lower(handle) = lower(?::text)", handle)) fail("That handle is taken.");
    const id = newUserId();
    await run(
      "INSERT INTO users (id, handle, display_name, password_hash, affiliation, created_at) VALUES (?,?,?,?,?,?)",
      id, handle, displayName, hashPassword(password), affiliation, now(),
    );
    await createSession(id);
  });
  if (result) return result;
  redirect(`/u/${handle}`);
}

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const next = safeNext(String(fd.get("next") ?? ""));
  const result = await guarded(async () => {
    const handle = str(fd, "handle", { required: true }).toLowerCase();
    const password = String(fd.get("password") ?? "");
    const u = await get<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE lower(handle) = lower(?::text)", handle);
    if (!u || !verifyPassword(password, u.password_hash)) fail("Wrong handle or password.");
    await createSession(u!.id);
  });
  if (result) return result;
  redirect(next);
}

const safeNext = (n: string) => (n.startsWith("/") && !n.startsWith("//") ? n : "/");

export async function logout() {
  await destroySession();
  redirect("/");
}

export async function updateProfile(_: FormState, fd: FormData): Promise<FormState> {
  const me = await currentUser();
  if (!me) return { error: "You need to sign in to do that." };
  const result = await guarded(async () => {
    let orcid = me.orcid;
    if (!me.orcid_verified_at) {
      const typed = str(fd, "orcid", { max: 19 }).toUpperCase();
      if (typed && !validOrcid(typed)) fail("That isn't a valid ORCID iD (they look like 0000-0002-1825-0097, with a checksum).");
      if (typed && (await get("SELECT 1 FROM users WHERE orcid = ? AND orcid_verified_at IS NOT NULL AND id <> ?", typed, me.id)))
        fail("Another account has verified that ORCID iD.");
      orcid = typed || null;
    }
    await run(
      "UPDATE users SET display_name = ?, bio = ?, affiliation = ?, orcid = ? WHERE id = ?",
      str(fd, "display_name", { required: true, max: 80 }),
      str(fd, "bio", { max: 2000 }),
      str(fd, "affiliation", { max: 200 }),
      orcid,
      me.id,
    );
  });
  if (result) return result;
  revalidatePath(`/u/${me.handle}`);
  redirect(`/u/${me.handle}`);
}

// ─────────────────────────── Contributions ───────────────────────────

function parseContent(fd: FormData, fallbackAuthor: string): VersionContent {
  const license = str(fd, "license") || DEFAULT_LICENSE;
  if (!AUTHOR_LICENSES.includes(license as License)) fail("Unknown license.");
  const authors = str(fd, "authors", { max: 5000 })
    .split(/[\n;]+/)
    .map((a) => a.trim())
    .filter(Boolean);

  const kinds = fd.getAll("artifact_kind").map(String);
  const labels = fd.getAll("artifact_label").map(String);
  const urls = fd.getAll("artifact_url").map(String);
  const pins = fd.getAll("artifact_pin").map(String);
  const artifacts: Artifact[] = [];
  urls.forEach((rawUrl, i) => {
    const url = rawUrl.trim();
    if (!url) return;
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {}
    if (!parsed || !["http:", "https:"].includes(parsed.protocol)) fail(`Artifact link "${url}" must be an http(s) URL.`);
    const kind = (ARTIFACT_KINDS as readonly string[]).includes(kinds[i]) ? (kinds[i] as ArtifactKind) : "other";
    artifacts.push({ kind, label: (labels[i] ?? "").trim().slice(0, 200), url, pin: (pins[i] ?? "").trim().slice(0, 200) });
  });
  if (artifacts.length > 30) fail("At most 30 artifacts per version.");

  const funders = fd.getAll("funding_funder").map((v) => String(v).trim().slice(0, 300));
  const grants = fd.getAll("funding_grant").map((v) => String(v).trim().slice(0, 200));
  const funding = funders.map((funder, i) => ({ funder, grant: grants[i] ?? "" })).filter((f) => f.funder);
  const coiMode = str(fd, "coi_mode");
  if (coiMode !== "none" && coiMode !== "declare") fail("Declare competing interests, or confirm there are none.");
  const coiText = str(fd, "coi_text", { max: 5000 });
  if (coiMode === "declare" && coiText.length < 10) fail("Describe the competing interests you are declaring.");
  const declarations: Declarations = { funding, competing_interests: coiMode === "declare" ? coiText : "" };

  return {
    title: str(fd, "title", { required: true, max: 300 }),
    abstract: str(fd, "abstract", { required: true, max: 5000 }),
    body: str(fd, "body", { max: 500_000 }),
    authors: authors.length ? authors : [fallbackAuthor],
    license: license as License,
    artifacts,
    declarations,
  };
}

export async function submitContribution(_: FormState, fd: FormData): Promise<FormState> {
  let id = "";
  const result = await guarded(async () => {
    const me = await requireUser();
    const type = str(fd, "type", { required: true }) as ContributionType;
    if (!(type in CONTRIBUTION_TYPES)) fail("Unknown contribution type.");
    const content = parseContent(fd, me.display_name);

    let replicationOf: string | null = null;
    let outcome: ReplicationOutcome | null = null;
    let targetOwner: string | null = null;
    if (type === "replication") {
      replicationOf = str(fd, "replication_of", { required: true }).replace(/^.*\/c\//, "");
      outcome = str(fd, "replication_outcome", { required: true }) as ReplicationOutcome;
      if (!(outcome in REPLICATION_OUTCOMES)) fail("Pick a replication outcome.");
      const target = await get<{ owner_id: string; status: string }>("SELECT owner_id, status FROM contributions WHERE id = ?", replicationOf);
      if (!target || target.status === "hidden") fail(`No contribution with id "${replicationOf}".`);
      targetOwner = target!.owner_id;
      if (await isAuthorOf(me.id, replicationOf)) fail("A replication must be independent — you can't replicate your own contribution.");
    }

    id = contributionId();
    const ts = now();
    const seq = await tx(async () => {
      await run(
        `INSERT INTO contributions (id, type, owner_id, latest_version, replication_of, replication_outcome, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        id, type, me.id, 1, replicationOf, outcome, ts, ts,
      );
      const v = await appendVersion({ contributionId: id, number: 1, content, changeNote: "Initial version", createdBy: me.id, createdAt: ts });
      await award(me.id, type === "replication" ? "replication_published" : type === "negative_result" ? "negative_result" : "contribution", id);
      if (targetOwner && outcome === "reproduced") await award(targetOwner, "replicated_by_others", id);
      if (reproEnabled()) await enqueueRun(v.seq, null);
      return v.seq;
    });
    after(() => runIntegrityChecks(seq));
  });
  if (result) return result;
  revalidatePath("/");
  redirect(`/c/${id}`);
}

export async function createVersion(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("contribution_id") ?? "");
  let number = 0;
  const result = await guarded(async () => {
    const me = await requireUser();
    const c = await get<{ owner_id: string; latest_version: number; status: string }>(
      "SELECT owner_id, latest_version, status FROM contributions WHERE id = ?",
      id,
    );
    if (!c) fail("Contribution not found.");
    if (c!.owner_id !== me.id) fail("Only the submitting author can post new versions.");
    if (c!.status === "hidden") fail("This contribution was removed by moderation. You can appeal from the moderation log.");
    const content = parseContent(fd, me.display_name);
    const changeNote = str(fd, "change_note", { required: true, max: 5000 });
    const seq = await tx(async () => {
      // Re-read inside the lock so concurrent edits can't claim the same number.
      number = (await get<{ v: number }>("SELECT latest_version AS v FROM contributions WHERE id = ?", id))!.v + 1;
      const ts = now();
      const v = await appendVersion({ contributionId: id, number, content, changeNote, createdBy: me.id, createdAt: ts });
      await run("UPDATE contributions SET latest_version = ?, updated_at = ? WHERE id = ?", number, ts, id);
      if (reproEnabled()) await enqueueRun(v.seq, null);
      return v.seq;
    });
    after(() => runIntegrityChecks(seq));
  });
  if (result) return result;
  revalidatePath(`/c/${id}`);
  redirect(`/c/${id}?v=${number}`);
}

// ───────────────────────────── Evaluation ─────────────────────────────

function rubric(fd: FormData, key: string): number {
  const n = Number(fd.get(key));
  if (!Number.isInteger(n) || n < 1 || n > 5) fail(`Score "${key}" must be 1–5.`);
  return n;
}

export async function submitReview(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("contribution_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    const c = await get<{ owner_id: string; latest_version: number; status: string }>(
      "SELECT owner_id, latest_version, status FROM contributions WHERE id = ?",
      id,
    );
    if (!c || c.status === "hidden") fail("Contribution not found.");
    if (await isAuthorOf(me.id, id)) fail("You can't review your own contribution — reply in the discussion instead.");
    const coiMode = str(fd, "coi_mode");
    if (coiMode !== "none" && coiMode !== "declare")
      fail("Declare any competing interests with the authors (collaborator, rival, same institution, funder...), or confirm there are none.");
    const coi = coiMode === "declare" ? str(fd, "coi_text", { max: 2000 }) : "";
    if (coiMode === "declare" && coi.length < 10) fail("Describe the competing interest you are declaring.");
    const version = Number(fd.get("version_number"));
    if (!Number.isInteger(version) || version < 1 || version > c!.latest_version) fail("Unknown version.");
    const recommendation = str(fd, "recommendation", { required: true }) as Recommendation;
    if (!(recommendation in RECOMMENDATIONS)) fail("Pick a recommendation.");
    const body = str(fd, "body", { required: true, max: 100_000 });
    if (body.length < 200)
      fail("Reviews need at least 200 characters. Engage with the methods, data and claims — a verdict alone isn't a review.");
    const license = str(fd, "license") || DEFAULT_LICENSE;
    if (!AUTHOR_LICENSES.includes(license as License)) fail("Unknown license.");
    const scores = [rubric(fd, "soundness"), rubric(fd, "reproducibility"), rubric(fd, "clarity"), rubric(fd, "significance")];
    const reviewId = `r_${shortId(10)}`;
    // A review is a publication: it is hashed into the review chain in the same transaction it is written.
    await tx(async () => {
      const ts = now();
      await run(
        `INSERT INTO reviews (id, contribution_id, version_number, reviewer_id, soundness, reproducibility, clarity, significance,
           recommendation, body, competing_interests, license, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        reviewId, id, version, me.id, ...scores, recommendation, body, coi, license, ts,
      );
      await appendReviewEntry(reviewId, ts);
    });
  });
  if (result) return result;
  revalidatePath(`/c/${id}`);
}

export async function voteHelpful(fd: FormData) {
  const me = await requireUser();
  const reviewId = String(fd.get("review_id") ?? "");
  const r = await get<{ reviewer_id: string; contribution_id: string; hidden: number }>(
    "SELECT reviewer_id, contribution_id, hidden FROM reviews WHERE id = ?",
    reviewId,
  );
  // Authors don't get to decide which reviews of their own work earn reputation.
  if (!r || r.hidden || r.reviewer_id === me.id || (await isAuthorOf(me.id, r.contribution_id))) return;
  await tx(async () => {
    if (await get("SELECT 1 FROM review_votes WHERE review_id = ? AND voter_id = ?", reviewId, me.id)) return;
    await run("INSERT INTO review_votes (review_id, voter_id, created_at) VALUES (?,?,?)", reviewId, me.id, now());
    await award(r.reviewer_id, "review_helpful", reviewId, await weightOf(me.id));
  });
  revalidatePath(`/c/${r.contribution_id}`);
}

export async function endorse(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("contribution_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    const c = await get<{ owner_id: string | null; status: string }>("SELECT owner_id, status FROM contributions WHERE id = ?", id);
    if (!c) fail("Contribution not found.");
    if (c!.status !== "active") fail("Retracted or removed work can't be endorsed.");
    if (await isAuthorOf(me.id, id)) fail("You can't endorse your own contribution.");
    const note = str(fd, "note", { max: 1000 });
    await tx(async () => {
      if (await get("SELECT 1 FROM endorsements WHERE contribution_id = ? AND user_id = ?", id, me.id)) fail("You already endorsed this.");
      await run("INSERT INTO endorsements (contribution_id, user_id, note, created_at) VALUES (?,?,?,?)", id, me.id, note, now());
      // Imported works have no owner on Fjournal, so the endorsement is recorded but credits no one.
      if (c!.owner_id) await award(c!.owner_id, "endorsement_received", `${id}:${me.id}`, await weightOf(me.id));
    });
  });
  if (result) return result;
  revalidatePath(`/c/${id}`);
}

export async function addComment(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("contribution_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    const c = await get<{ latest_version: number; status: string }>("SELECT latest_version, status FROM contributions WHERE id = ?", id);
    if (!c || c.status === "hidden") fail("Contribution not found.");
    const body = str(fd, "body", { required: true, max: 20_000 });
    const version = Number(fd.get("version_number")) || c!.latest_version;
    await run(
      "INSERT INTO comments (id, contribution_id, version_number, author_id, body, created_at) VALUES (?,?,?,?,?,?)",
      `m_${shortId(10)}`, id, Math.min(version, c!.latest_version), me.id, body, now(),
    );
  });
  if (result) return result;
  revalidatePath(`/c/${id}`);
}

// ───────────────────────────── Imported works ─────────────────────────────

/** Network failures are not the user's fault; say so instead of crashing the form. */
async function importOrExplain(identifier: string, userId: string) {
  try {
    return await importWork(identifier, userId);
  } catch (e) {
    if (e instanceof ImportError) throw e;
    console.error("import failed", e);
    return fail(`Couldn't reach the source right now (${e instanceof Error ? e.message : "network error"}). Please try again in a minute.`);
  }
}

export async function importPaper(_: FormState, fd: FormData): Promise<FormState> {
  let id = "";
  const result = await guarded(async () => {
    const me = await requireUser();
    const r = await importOrExplain(str(fd, "identifier", { required: true, max: 500 }), me.id);
    id = r.id;
    if (r.seq !== null) after(() => runIntegrityChecks(r.seq!));
  });
  if (result) return result;
  revalidatePath("/");
  redirect(`/c/${id}`);
}

/** Anyone signed in can ask whether the preprint server has a newer version than the one on record. */
export async function refreshImport(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("contribution_id") ?? "");
  let number = 0;
  let upToDate = false;
  const result = await guarded(async () => {
    const me = await requireUser();
    const c = await get<{ source_kind: string | null; source_id: string | null }>("SELECT source_kind, source_id FROM contributions WHERE id = ?", id);
    if (!c?.source_id) fail("This work was published on Fjournal; its authors post new versions themselves.");
    const query = c!.source_kind === "arxiv" ? `arxiv:${c!.source_id}` : `doi:${c!.source_id}`;
    const r = await importOrExplain(query, me.id);
    if (r.status !== "updated") {
      upToDate = true;
      return;
    }
    number = (await get<{ v: number }>("SELECT latest_version AS v FROM contributions WHERE id = ?", id))!.v;
    after(() => runIntegrityChecks(r.seq!));
  });
  if (result) return result;
  if (upToDate) return { ok: "Already up to date: this is the latest version at the source." };
  revalidatePath(`/c/${id}`);
  redirect(`/c/${id}?v=${number}`);
}

// ───────────────────────────── Citable reviews & authorship ─────────────────────────────

export async function requestReviewDoi(_: FormState, fd: FormData): Promise<FormState> {
  const reviewId = String(fd.get("review_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    await tx(() => reserveReviewDoi(reviewId, me.id));
    after(() => registerReviewDoi(reviewId));
  });
  if (result) return result;
  revalidatePath(`/r/${reviewId}`);
  return { ok: "DOI requested. Registration with DataCite takes a few seconds — refresh to see it." };
}

export async function claimAuthorshipAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("contribution_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    try {
      await claimAuthorship(me.id, id);
    } catch (e) {
      if (e instanceof ClaimError) throw e;
      fail(`Couldn't check your ORCID record right now (${e instanceof Error ? e.message : "network error"}). Try again shortly.`);
    }
  });
  if (result) return result;
  revalidatePath(`/c/${id}`);
  return { ok: "Verified: your ORCID record lists this work. You're now shown as an author." };
}

export async function disconnectOrcid() {
  const me = await requireUser();
  if (!(await get("SELECT 1 FROM users WHERE id = ? AND password_hash LIKE 'scrypt$%'", me.id)))
    redirect("/settings?orcid=needs-password");
  await run("UPDATE users SET orcid = NULL, orcid_verified_at = NULL WHERE id = ?", me.id);
  redirect("/settings?orcid=disconnected");
}

/** Completes a first-time ORCID sign-in: the iD was verified by ORCID and is carried in a signed cookie. */
export async function signupWithOrcid(_: FormState, fd: FormData): Promise<FormState> {
  let handle = "";
  const result = await guarded(async () => {
    const jar = await cookies();
    const pending = await unsign<{ orcid: string; name: string }>(jar.get("fj_orcid_pending")?.value);
    if (!pending) fail("Your ORCID sign-in expired. Please sign in with ORCID again.");
    handle = str(fd, "handle", { required: true, max: 32 }).toLowerCase();
    const displayName = str(fd, "display_name", { required: true, max: 80 });
    if (!/^[a-z0-9_-]{3,32}$/.test(handle)) fail("Handle must be 3–32 characters: a–z, 0–9, _ or -.");
    if (await get("SELECT 1 FROM users WHERE lower(handle) = lower(?::text)", handle)) fail("That handle is taken.");
    if (await get("SELECT 1 FROM users WHERE orcid = ? AND orcid_verified_at IS NOT NULL", pending!.orcid))
      fail("An account already uses this ORCID iD. Sign in with ORCID instead.");
    const id = newUserId();
    await run(
      `INSERT INTO users (id, handle, display_name, password_hash, affiliation, orcid, orcid_verified_at, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      id, handle, displayName, "orcid-only", str(fd, "affiliation", { max: 200 }), pending!.orcid, now(), now(),
    );
    jar.delete("fj_orcid_pending");
    await createSession(id);
  });
  if (result) return result;
  redirect(`/u/${handle}`);
}

// ───────────────────────────── Reproducibility bot ─────────────────────────────

export async function requestReproduction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("contribution_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    const v = await get<{ seq: number }>("SELECT seq FROM versions WHERE contribution_id = ? AND number = ?", id, Number(fd.get("version_number")));
    if (!v) fail("Version not found.");
    await requestRun(v!.seq, me.id);
  });
  if (result) return result;
  revalidatePath(`/c/${id}`);
  return { ok: "Queued. The bot runs one job at a time; results appear here when it finishes." };
}

// ───────────────────────────── Collections ─────────────────────────────

function collectionInput(fd: FormData) {
  return validateCollectionInput({
    name: str(fd, "name", { max: 200 }),
    tagline: str(fd, "tagline", { max: 400 }),
    scope: str(fd, "scope", { max: 6000 }),
    policy: str(fd, "policy", { max: 12_000 }),
    min_reviews: str(fd, "min_reviews"),
    accepts_submissions: fd.get("accepts_submissions") === "1",
    accent: str(fd, "accent", { max: 20 }),
    lineage_journal: str(fd, "lineage_journal", { max: 300 }),
    lineage_publisher: str(fd, "lineage_publisher", { max: 300 }),
    lineage_statement: str(fd, "lineage_statement", { max: 1200 }),
    lineage_year: str(fd, "lineage_year", { max: 10 }),
  });
}

const slugOf = async (collectionId: string) =>
  (await get<{ slug: string }>("SELECT slug FROM collections WHERE id = ?", collectionId))?.slug ?? "";

async function revalidateCollection(collectionId: string, contributionId?: string) {
  const slug = await slugOf(collectionId);
  revalidatePath(`/j/${slug}`);
  revalidatePath(`/j/${slug}/desk`);
  revalidatePath("/collections");
  if (contributionId) revalidatePath(`/c/${contributionId}`);
}

export async function createCollectionAction(_: FormState, fd: FormData): Promise<FormState> {
  let slug = "";
  const result = await guarded(async () => {
    const me = await requireUser();
    slug = await createCollection(me.id, str(fd, "slug", { required: true, max: 60 }), collectionInput(fd));
  });
  if (result) return result;
  revalidatePath("/collections");
  redirect(`/j/${slug}/desk?founded=1`);
}

export async function updateCollectionAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("collection_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    await updateCollection(me.id, id, collectionInput(fd));
  });
  if (result) return result;
  await revalidateCollection(id);
  return { ok: "Saved. The new policy applies from now on, and the change is in the public log." };
}

export async function inviteMemberAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("collection_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    await inviteMember(me.id, id, str(fd, "handle", { required: true, max: 40 }), str(fd, "role") as Role);
  });
  if (result) return result;
  await revalidateCollection(id);
  return { ok: "Invitation sent. It appears in their settings; they join the board when they accept." };
}

export async function respondInvitationAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("collection_id") ?? "");
  const accept = fd.get("answer") === "accept";
  const result = await guarded(async () => {
    const me = await requireUser();
    await respondToInvitation(me.id, id, accept);
  });
  if (result) return result;
  await revalidateCollection(id);
  revalidatePath("/settings");
  if (accept) redirect(`/j/${await slugOf(id)}/desk`);
  return { ok: "Invitation declined." };
}

export async function leaveBoardAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("collection_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    await leaveBoard(me.id, id);
  });
  if (result) return result;
  await revalidateCollection(id);
  redirect(`/j/${await slugOf(id)}`);
}

export async function manageMemberAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("collection_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    const userId = String(fd.get("user_id") ?? "");
    if (fd.get("op") === "remove") await removeMember(me.id, id, userId, str(fd, "reason", { max: 2000 }));
    else await setRole(me.id, id, userId, str(fd, "role") as Role);
  });
  if (result) return result;
  await revalidateCollection(id);
  return { ok: "Done. The change is in the public log." };
}

export async function submitToCollectionAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("collection_id") ?? "");
  const contribution = String(fd.get("contribution_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    if (!id) fail("Choose a collection.");
    await submitWork(me.id, id, contribution, str(fd, "note", { max: 2000 }));
  });
  if (result) return result;
  await revalidateCollection(id, contribution);
  return { ok: "Submitted. The board decides in public; you can withdraw at any time." };
}

/** Editors nominate any work by its Fjournal id or link, or by an arXiv id or DOI (imported first if needed). */
export async function nominateAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("collection_id") ?? "");
  let contribution = "";
  const result = await guarded(async () => {
    const me = await requireUser();
    const raw = str(fd, "identifier", { required: true, max: 500 });
    const local = raw.match(/(?:^(?:fj:)?|\/c\/)(\d{4}\.[a-z0-9]+)(?:[/?#]|$)/i)?.[1];
    if (local && (await get("SELECT 1 FROM contributions WHERE id = ?", local))) contribution = local;
    else {
      const r = await importOrExplain(raw, me.id);
      contribution = r.id;
      if (r.seq !== null) after(() => runIntegrityChecks(r.seq!));
    }
    await nominateWork(me.id, id, contribution, str(fd, "note", { max: 2000 }));
  });
  if (result) return result;
  await revalidateCollection(id, contribution);
  return { ok: `Nominated fj:${contribution}. It's now under consideration.` };
}

export async function withdrawFromCollectionAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("collection_id") ?? "");
  const contribution = String(fd.get("contribution_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    await withdrawWork(me.id, id, contribution, str(fd, "note", { max: 2000 }));
  });
  if (result) return result;
  await revalidateCollection(id, contribution);
  return { ok: "Withdrawn. The record of it stays in the collection's log." };
}

export async function decideAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("collection_id") ?? "");
  const contribution = String(fd.get("contribution_id") ?? "");
  const select = fd.get("decision") === "select";
  const result = await guarded(async () => {
    const me = await requireUser();
    if (fd.get("decision") !== "select" && fd.get("decision") !== "decline") fail("Choose select or decline.");
    const coiMode = str(fd, "coi_mode");
    if (coiMode !== "none" && coiMode !== "declare") fail("Declare any competing interests with the authors, or confirm there are none.");
    const coi = coiMode === "declare" ? str(fd, "coi_text", { max: 2000 }) : "";
    if (coiMode === "declare" && coi.length < 10) fail("Describe the competing interest you are declaring.");
    await decide(me.id, id, contribution, { select, note: str(fd, "note", { max: 10_000 }), competingInterests: coi });
  });
  if (result) return result;
  await revalidateCollection(id, contribution);
  revalidatePath("/");
  return { ok: select ? "Selected. The decision is signed and in the public log." : "Recorded as not selected, with your reasoning." };
}

export async function deselectAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("collection_id") ?? "");
  const contribution = String(fd.get("contribution_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    await deselect(me.id, id, contribution, str(fd, "note", { max: 10_000 }));
  });
  if (result) return result;
  await revalidateCollection(id, contribution);
  revalidatePath("/");
  return { ok: "Selection withdrawn, with your reasoning in the public log." };
}

// ───────────────────────────── Scrutiny reports ─────────────────────────────

export async function saveReportSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  let handle = "";
  const result = await guarded(async () => {
    const me = await requireUser();
    handle = me.handle;
    await saveReportSettings(me.id, str(fd, "statement", { max: 5000 }), fd.getAll("highlight").map(String));
  });
  if (result) return result;
  revalidatePath(`/u/${handle}/report`);
  return { ok: "Saved. Your report now shows your statement and the works you chose." };
}

export async function freezeReportAction(_: FormState, fd: FormData): Promise<FormState> {
  let id = "";
  const result = await guarded(async () => {
    const me = await requireUser();
    const years = PERIODS.find((p) => String(p) === String(fd.get("years") ?? "")) ?? null;
    id = await freezeReport(String(fd.get("handle") ?? ""), me.id, years);
  });
  if (result) return result;
  redirect(`/report/${id}`);
}

// ───────────────────────────── Journal Integrity Index ─────────────────────────────

function revalidateIndex(issn?: string) {
  revalidatePath("/journals");
  revalidatePath("/journals/review");
  if (issn) revalidatePath(`/journals/${issn}`);
}
const issnOfAssessment = async (id: string) => (await get<{ issn: string }>("SELECT issn FROM index_assessments WHERE id = ?", id))?.issn;

export async function publishAssessmentAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("assessment_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    await publishAssessment(me, id);
  });
  if (result) return result;
  revalidateIndex(await issnOfAssessment(id));
  return { ok: "Published. Its hash is fixed now; corrections are listed publicly next to it." };
}

export async function withdrawAssessmentAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("assessment_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    await withdrawAssessment(me, id, str(fd, "reason", { max: 2000 }));
  });
  if (result) return result;
  revalidateIndex(await issnOfAssessment(id));
  return { ok: "Withdrawn, with the reason shown publicly." };
}

export async function submitReplyAction(_: FormState, fd: FormData): Promise<FormState> {
  const issn = String(fd.get("issn") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    await submitReply(me, issn, str(fd, "role", { max: 200 }), str(fd, "body", { max: 6000 }));
  });
  if (result) return result;
  revalidateIndex(issn);
  return { ok: "Received. A moderator will confirm that you speak for the journal, then publish your reply exactly as written." };
}

export async function reviewReplyAction(_: FormState, fd: FormData): Promise<FormState> {
  const result = await guarded(async () => {
    const me = await requireUser();
    await reviewReply(me, String(fd.get("reply_id") ?? ""), fd.get("decision") === "publish", str(fd, "note", { max: 1000 }));
  });
  if (result) return result;
  revalidateIndex(String(fd.get("issn") ?? ""));
  return { ok: "Done." };
}

export async function requestCorrectionAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("assessment_id") ?? "");
  const result = await guarded(async () => {
    const me = await requireUser();
    await requestCorrection(me, id, str(fd, "doi", { max: 300 }) || null, str(fd, "indicator"), str(fd, "claim", { max: 6000 }), str(fd, "evidence_url", { max: 1000 }));
  });
  if (result) return result;
  revalidateIndex(await issnOfAssessment(id));
  return { ok: "Correction request filed publicly. A moderator will resolve it, with reasons." };
}

export async function resolveCorrectionAction(_: FormState, fd: FormData): Promise<FormState> {
  const result = await guarded(async () => {
    const me = await requireUser();
    await resolveCorrection(me, String(fd.get("correction_id") ?? ""), fd.get("decision") === "accept", str(fd, "resolution", { max: 5000 }));
  });
  if (result) return result;
  revalidateIndex(String(fd.get("issn") ?? ""));
  return { ok: "Resolved publicly." };
}

// ───────────────────────────── Integrity checks ─────────────────────────────

export async function rerunChecks(fd: FormData) {
  const me = await requireUser();
  const id = String(fd.get("contribution_id") ?? "");
  const number = Number(fd.get("version_number"));
  const v = await get<{ seq: number; owner_id: string | null; imported_by: string | null }>(
    `SELECT v.seq, c.owner_id, c.imported_by FROM versions v JOIN contributions c ON c.id = v.contribution_id
     WHERE v.contribution_id = ? AND v.number = ?`,
    id,
    number,
  );
  if (!v || (v.owner_id !== me.id && v.imported_by !== me.id && !(await isModerator(me)))) return;
  await runIntegrityChecks(v.seq);
  revalidatePath(`/c/${id}`);
}

// ───────────────────────────── Moderation ─────────────────────────────

const TARGET_TYPES: ModerationTarget[] = ["contribution", "review", "comment"];

export async function reportContent(_: FormState, fd: FormData): Promise<FormState> {
  const result = await guarded(async () => {
    const me = await requireUser();
    const type = String(fd.get("target_type")) as ModerationTarget;
    if (!TARGET_TYPES.includes(type)) fail("Unknown target.");
    await fileReport({
      reporterId: me.id,
      type,
      targetId: String(fd.get("target_id") ?? ""),
      reason: str(fd, "reason"),
      details: str(fd, "details", { max: 5000 }),
    });
  });
  return result ?? { ok: "Report received. A moderator will review it. Any action will appear in the public moderation log." };
}

async function requireModerator() {
  const me = await requireUser();
  if (!(await isModerator(me))) fail("Only moderators can do that.");
  return me;
}

export async function actOnReport(_: FormState, fd: FormData): Promise<FormState> {
  let seq = 0;
  const result = await guarded(async () => {
    const me = await requireModerator();
    const reportId = String(fd.get("report_id") ?? "");
    const rep = await get<{ target_type: ModerationTarget; target_id: string; status: string }>(
      "SELECT target_type, target_id, status FROM reports WHERE id = ?",
      reportId,
    );
    if (!rep || rep.status !== "open") fail("This report is no longer open.");
    seq = await tx(() =>
      takeAction({
        moderatorId: me.id,
        type: rep!.target_type,
        targetId: rep!.target_id,
        reason: str(fd, "reason"),
        explanation: str(fd, "explanation", { max: 10_000 }),
        evidenceUrl: str(fd, "evidence_url", { max: 1000 }),
        reportId,
      }),
    );
  });
  if (result) return result;
  revalidatePath("/moderation");
  redirect(`/moderation/${seq}`);
}

export async function dismissReportAction(_: FormState, fd: FormData): Promise<FormState> {
  const result = await guarded(async () => {
    const me = await requireModerator();
    await dismissReport(me.id, String(fd.get("report_id") ?? ""), str(fd, "note", { max: 5000 }));
  });
  if (result) return result;
  revalidatePath("/moderation/queue");
}

export async function appealAction(_: FormState, fd: FormData): Promise<FormState> {
  const seq = Number(fd.get("action_seq"));
  const result = await guarded(async () => {
    const me = await requireUser();
    await fileAppeal(me.id, seq, str(fd, "statement", { max: 10_000 }));
  });
  if (result) return result;
  revalidatePath(`/moderation/${seq}`);
}

export async function resolveAppealAction(_: FormState, fd: FormData): Promise<FormState> {
  const seq = Number(fd.get("action_seq"));
  const result = await guarded(async () => {
    const me = await requireModerator();
    const outcome = str(fd, "outcome");
    if (outcome !== "upheld" && outcome !== "overturned") fail("Choose an outcome.");
    await tx(() => resolveAppeal(me.id, String(fd.get("appeal_id") ?? ""), outcome as "upheld" | "overturned", str(fd, "resolution", { max: 10_000 })));
  });
  if (result) return result;
  revalidatePath(`/moderation/${seq}`);
  revalidatePath("/moderation");
}
