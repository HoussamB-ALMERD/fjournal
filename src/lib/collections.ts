import "server-only";
import { all, get, run, tx, now } from "./db";
import { shortId } from "./ids";
import { canonicalJson, sha256 } from "./hash";
import { appendCollectionEntry, collectionPolicy, type CollectionPolicy } from "./ledger";
import { isAuthorOf } from "./authors";

/**
 * Collections: curated spaces run by an editorial board, on top of open publication. A board can bring
 * its community, its standards and its name here without a publisher. Selection is a public, signed,
 * reasoned judgement layered on top of the open record — it never decides what gets published, and it
 * never earns anyone reputation. Every board change and decision is appended to the collection chain.
 * These rules are enforced here, not just in the UI.
 */

export class CollectionError extends Error {}
const fail = (m: string): never => {
  throw new CollectionError(m);
};

export type Role = "managing" | "editor";
export const ROLES: Record<Role, { label: string; hint: string }> = {
  managing: { label: "Managing editor", hint: "Decides on works, and manages the board and the published policy." },
  editor: { label: "Editor", hint: "Decides on works and nominates them." },
};

export type ItemStatus = "submitted" | "selected" | "declined" | "withdrawn" | "removed";
export const ITEM_STATUS: Record<ItemStatus, string> = {
  submitted: "Under consideration",
  selected: "Selected",
  declined: "Not selected",
  withdrawn: "Withdrawn",
  removed: "Selection withdrawn by the board",
};

/** The journal a board left to come here. A claim made by the board, shown with its evidence. */
export type Lineage = { journal: string; publisher: string; statement_url: string; year: number | null };

export type Collection = Omit<CollectionPolicy, "continues"> & {
  id: string;
  slug: string;
  continues: Lineage | null;
  status: "active" | "hidden";
  created_by: string;
  created_at: string;
  updated_at: string;
};

export const LIMITS = { minReviews: [1, 10], board: 200, perCreator30d: 3, submissionsPerDay: 10, invitesPerDay: 30 } as const;
const RESERVED = new Set(["new", "api", "admin", "fjournal", "collections", "settings", "desk", "log"]);

type Raw = Omit<Collection, "continues"> & { continues: string | null };
const parse = (r: Raw): Collection => ({ ...r, continues: r.continues ? JSON.parse(r.continues) : null });

// ───────────────────────────── Validation ─────────────────────────────

export type CollectionInput = Omit<CollectionPolicy, "continues"> & { continues: Lineage | null };

/** Turns raw form values into a collection's public settings, or explains what's wrong. */
export function validateCollectionInput(v: {
  name: string; tagline: string; scope: string; policy: string; min_reviews: string; accepts_submissions: boolean; accent: string;
  lineage_journal: string; lineage_publisher: string; lineage_statement: string; lineage_year: string;
}): CollectionInput {
  const name = v.name.trim();
  if (name.length < 3 || name.length > 120) fail("The name must be 3–120 characters.");
  if (v.tagline.trim().length > 200) fail("Keep the tagline under 200 characters.");
  const scope = v.scope.trim();
  if (scope.length < 30 || scope.length > 5000) fail("Describe the scope in 30–5000 characters: which fields and kinds of work the collection covers.");
  const policy = v.policy.trim();
  if (policy.length < 100 || policy.length > 10000)
    fail("Write the selection criteria in 100–10000 characters. Authors and readers should be able to check every decision against them.");
  const min = Number(v.min_reviews);
  if (!Number.isInteger(min) || min < LIMITS.minReviews[0] || min > LIMITS.minReviews[1])
    fail(`Selection must rest on at least ${LIMITS.minReviews[0]} and at most ${LIMITS.minReviews[1]} public reviews.`);
  const accent = v.accent.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(accent)) fail("The accent colour must be a hex colour like #1d4ed8.");

  let continues: Lineage | null = null;
  const journal = v.lineage_journal.trim();
  if (journal) {
    if (journal.length > 200) fail("The former journal's name is too long.");
    const url = v.lineage_statement.trim();
    let ok = false;
    try {
      ok = ["http:", "https:"].includes(new URL(url).protocol);
    } catch {}
    if (!ok)
      fail("Link the board's public statement (resignation letter, announcement or news report). A lineage claim needs evidence anyone can check.");
    const year = v.lineage_year.trim() ? Number(v.lineage_year) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1665 || year > new Date().getUTCFullYear()))
      fail("Give the year the board moved as a four-digit year.");
    continues = { journal, publisher: v.lineage_publisher.trim().slice(0, 200), statement_url: url.slice(0, 1000), year };
  } else if (v.lineage_statement.trim() || v.lineage_publisher.trim()) {
    fail("Name the journal your board is continuing, or leave all the lineage fields empty.");
  }
  return { name, tagline: v.tagline.trim(), scope, policy, min_reviews: min, accepts_submissions: v.accepts_submissions ? 1 : 0, accent, continues };
}

export function validateSlug(raw: string): string {
  const slug = raw.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug))
    fail("The address must be 3–40 characters: a–z, 0–9 and hyphens, not starting or ending with a hyphen.");
  if (RESERVED.has(slug)) fail("That address is reserved.");
  return slug;
}

const snapshot = (c: CollectionInput): CollectionPolicy => ({ ...c, continues: c.continues });
export const policyHash = (c: Collection) => sha256(canonicalJson(collectionPolicy({ ...c, continues: c.continues ? JSON.stringify(c.continues) : null })));

// ───────────────────────────── Reads ─────────────────────────────

export async function getCollection(slug: string): Promise<Collection | undefined> {
  const r = await get<Raw>("SELECT * FROM collections WHERE lower(slug) = lower(?::text) AND status = 'active'", slug);
  return r && parse(r);
}

async function byId(id: string): Promise<Collection> {
  const r = await get<Raw>("SELECT * FROM collections WHERE id = ? AND status = 'active'", id);
  return r ? parse(r) : fail("Collection not found.");
}

export async function listCollections() {
  return (await all<Raw & { board: number; verified: number; selected: number; considering: number }>(
    `SELECT c.*,
       (SELECT COUNT(*) FROM collection_members m WHERE m.collection_id = c.id AND m.status = 'active') AS board,
       (SELECT COUNT(*) FROM collection_members m JOIN users u ON u.id = m.user_id
          WHERE m.collection_id = c.id AND m.status = 'active' AND u.orcid_verified_at IS NOT NULL) AS verified,
       (SELECT COUNT(*) FROM collection_items i WHERE i.collection_id = c.id AND i.status = 'selected') AS selected,
       (SELECT COUNT(*) FROM collection_items i WHERE i.collection_id = c.id AND i.status = 'submitted') AS considering
     FROM collections c WHERE c.status = 'active' ORDER BY selected DESC, c.created_at ASC`,
  )).map((r) => ({ ...parse(r), board: r.board, verified: r.verified, selected: r.selected, considering: r.considering }));
}

export type BoardMember = {
  user_id: string; handle: string; display_name: string; affiliation: string; role: Role;
  status: "invited" | "active" | "declined" | "left" | "removed"; orcid: string | null; since: string;
};

/** The public board. Only ORCID iDs proven by signing in are shown. */
export function boardOf(collectionId: string, statuses: BoardMember["status"][] = ["active"]) {
  return all<BoardMember>(
    `SELECT m.user_id, u.handle, u.display_name, u.affiliation, m.role, m.status, m.updated_at AS since,
       CASE WHEN u.orcid_verified_at IS NOT NULL THEN u.orcid END AS orcid
     FROM collection_members m JOIN users u ON u.id = m.user_id
     WHERE m.collection_id = ? AND m.status IN (${statuses.map(() => "?").join(",")})
     ORDER BY m.role = 'managing' DESC, m.created_at ASC`,
    collectionId, ...statuses,
  );
}

/** The viewer's role on the board, if they are an active member. */
export async function roleOf(collectionId: string, userId: string | undefined): Promise<Role | null> {
  if (!userId) return null;
  return (await get<{ role: Role }>("SELECT role FROM collection_members WHERE collection_id = ? AND user_id = ? AND status = 'active'", collectionId, userId))?.role ?? null;
}

export type Item = {
  contribution_id: string; status: ItemStatus; version_number: number; nominated: number; note: string;
  title: string; authors: string; latest_version: number; work_status: string; review_count: number;
  submitted_by_handle: string; decided_by_handle: string | null; decided_by_name: string | null;
  decision_note: string | null; decided_at: string | null; log_seq: number; created_at: string;
};

export function itemsOf(collectionId: string, statuses: ItemStatus[]) {
  return all<Item>(
    `SELECT i.contribution_id, i.status, i.version_number, i.nominated, i.note, i.decision_note, i.decided_at, i.log_seq, i.created_at,
       v.title, v.authors, c.latest_version, c.status AS work_status, s.handle AS submitted_by_handle,
       d.handle AS decided_by_handle, d.display_name AS decided_by_name,
       (SELECT COUNT(*) FROM reviews r WHERE r.contribution_id = c.id AND r.hidden = 0) AS review_count
     FROM collection_items i
     JOIN contributions c ON c.id = i.contribution_id
     JOIN versions v ON v.contribution_id = c.id AND v.number = c.latest_version
     JOIN users s ON s.id = i.submitted_by
     LEFT JOIN users d ON d.id = i.decided_by
     WHERE i.collection_id = ? AND i.status IN (${statuses.map(() => "?").join(",")}) AND c.status <> 'hidden'
     ORDER BY COALESCE(i.decided_at, i.created_at) DESC`,
    collectionId, ...statuses,
  );
}

/** Where a work stands in every collection that has considered it. */
export function collectionsForWork(contributionId: string) {
  return all<{
    collection_id: string; slug: string; name: string; accent: string; status: ItemStatus; version_number: number; nominated: number;
    decision_note: string | null; decided_at: string | null; decided_by_handle: string | null; log_seq: number;
  }>(
    `SELECT i.collection_id, co.slug, co.name, co.accent, i.status, i.version_number, i.nominated, i.decision_note, i.decided_at,
       d.handle AS decided_by_handle, i.log_seq
     FROM collection_items i JOIN collections co ON co.id = i.collection_id
     LEFT JOIN users d ON d.id = i.decided_by
     WHERE i.contribution_id = ? AND co.status = 'active' ORDER BY i.updated_at DESC`,
    contributionId,
  );
}

/** For feed cards: which collections selected each work. */
export async function selectionsFor(contributionIds: string[]) {
  const out = new Map<string, { slug: string; name: string; accent: string }[]>();
  if (contributionIds.length === 0) return out;
  const rows = await all<{ contribution_id: string; slug: string; name: string; accent: string }>(
    `SELECT i.contribution_id, co.slug, co.name, co.accent FROM collection_items i JOIN collections co ON co.id = i.collection_id
     WHERE i.status = 'selected' AND co.status = 'active' AND i.contribution_id IN (${contributionIds.map(() => "?").join(",")})
     ORDER BY i.decided_at ASC`,
    ...contributionIds,
  );
  for (const r of rows) out.set(r.contribution_id, [...(out.get(r.contribution_id) ?? []), { slug: r.slug, name: r.name, accent: r.accent }]);
  return out;
}

/** Collections a member of a board could submit this work to (the caller checks authorship). */
export function openForSubmission(contributionId: string) {
  return all<{ id: string; slug: string; name: string }>(
    `SELECT co.id, co.slug, co.name FROM collections co
     WHERE co.status = 'active' AND co.accepts_submissions = 1
       AND NOT EXISTS (SELECT 1 FROM collection_items i WHERE i.collection_id = co.id AND i.contribution_id = ? AND i.status IN ('submitted','selected'))
     ORDER BY lower(co.name)`,
    contributionId,
  );
}

export function invitationsFor(userId: string) {
  return all<{ collection_id: string; slug: string; name: string; role: Role; invited_by_handle: string | null; created_at: string }>(
    `SELECT m.collection_id, co.slug, co.name, m.role, u.handle AS invited_by_handle, m.updated_at AS created_at
     FROM collection_members m JOIN collections co ON co.id = m.collection_id LEFT JOIN users u ON u.id = m.invited_by
     WHERE m.user_id = ? AND m.status = 'invited' AND co.status = 'active' ORDER BY m.updated_at DESC`,
    userId,
  );
}

/** A member's editorial service, current and past: public, like everything else they do here. */
export function boardServiceOf(userId: string) {
  return all<{ slug: string; name: string; role: Role; status: string; decisions: number; since: string }>(
    `SELECT co.slug, co.name, m.role, m.status, m.created_at AS since,
       (SELECT COUNT(*) FROM collection_log l WHERE l.collection_id = co.id AND l.actor_id = m.user_id AND l.kind IN ('selected','declined')) AS decisions
     FROM collection_members m JOIN collections co ON co.id = m.collection_id
     WHERE m.user_id = ? AND m.status IN ('active','left') AND co.status = 'active' ORDER BY m.status = 'active' DESC, m.created_at ASC`,
    userId,
  );
}

export type LogEntry = {
  seq: number; kind: string; actor_handle: string; actor_name: string; subject: string | null; subject_label: string | null; subject_handle: string | null;
  payload: Record<string, unknown>; content_hash: string; chain_hash: string; created_at: string;
};

export async function logOf(collectionId: string, limit = 500): Promise<LogEntry[]> {
  return (await all<Omit<LogEntry, "payload"> & { payload: string }>(
    `SELECT l.seq, l.kind, l.subject, l.payload, l.content_hash, l.chain_hash, l.created_at,
       a.handle AS actor_handle, a.display_name AS actor_name, su.handle AS subject_handle,
       COALESCE(su.display_name, (SELECT v.title FROM versions v JOIN contributions c ON c.id = v.contribution_id AND v.number = c.latest_version
                                   WHERE c.id = l.subject AND c.status <> 'hidden')) AS subject_label
     FROM collection_log l JOIN users a ON a.id = l.actor_id LEFT JOIN users su ON su.id = l.subject
     WHERE l.collection_id = ? ORDER BY l.seq DESC LIMIT ?`,
    collectionId, limit,
  )).map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}

// ───────────────────────────── Founding & policy ─────────────────────────────

export async function createCollection(userId: string, slugRaw: string, input: CollectionInput): Promise<string> {
  const slug = validateSlug(slugRaw);
  return tx(async () => {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    if ((await get<{ n: number }>("SELECT COUNT(*) AS n FROM collections WHERE created_by = ? AND created_at > ?", userId, since))!.n >= LIMITS.perCreator30d)
      fail(`You can found at most ${LIMITS.perCreator30d} collections in 30 days.`);
    if (await get("SELECT 1 FROM collections WHERE lower(slug) = lower(?::text)", slug)) fail("That address is taken.");
    if (await get("SELECT 1 FROM collections WHERE lower(name) = lower(?::text)", input.name)) fail("A collection with that name already exists.");
    const id = `col_${shortId(8)}`;
    const ts = now();
    await run(
      `INSERT INTO collections (id, slug, name, tagline, scope, policy, min_reviews, accepts_submissions, accent, continues, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, slug, input.name, input.tagline, input.scope, input.policy, input.min_reviews, input.accepts_submissions, input.accent,
      input.continues ? JSON.stringify(input.continues) : null, userId, ts, ts,
    );
    await run(
      "INSERT INTO collection_members (collection_id, user_id, role, status, invited_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      id, userId, "managing", "active", null, ts, ts,
    );
    await appendCollectionEntry({ collectionId: id, kind: "founded", actorId: userId, subject: userId, payload: { slug, role: "managing", ...snapshot(input) }, createdAt: ts });
    return slug;
  });
}

const requireRole = async (collectionId: string, userId: string, roles: Role[] = ["managing", "editor"]): Promise<Role> => {
  const r = await roleOf(collectionId, userId);
  if (!r) fail("Only members of this collection's board can do that.");
  if (!roles.includes(r!)) fail("Only managing editors can do that.");
  return r!;
};

export async function updateCollection(userId: string, collectionId: string, input: CollectionInput) {
  await tx(async () => {
    const c = await byId(collectionId);
    await requireRole(collectionId, userId, ["managing"]);
    const next = snapshot(input);
    const current = collectionPolicy({ ...c, continues: c.continues ? JSON.stringify(c.continues) : null });
    if (canonicalJson(next) === canonicalJson(current)) fail("Nothing changed.");
    if (await get("SELECT 1 FROM collections WHERE lower(name) = lower(?::text) AND id <> ?", input.name, collectionId)) fail("A collection with that name already exists.");
    const ts = now();
    await run(
      `UPDATE collections SET name = ?, tagline = ?, scope = ?, policy = ?, min_reviews = ?, accepts_submissions = ?, accent = ?, continues = ?, updated_at = ?
       WHERE id = ?`,
      input.name, input.tagline, input.scope, input.policy, input.min_reviews, input.accepts_submissions, input.accent,
      input.continues ? JSON.stringify(input.continues) : null, ts, collectionId,
    );
    await appendCollectionEntry({ collectionId, kind: "policy", actorId: userId, subject: null, payload: next, createdAt: ts });
  });
}

// ───────────────────────────── The board ─────────────────────────────

const activeManagers = async (collectionId: string) =>
  (await get<{ n: number }>("SELECT COUNT(*) AS n FROM collection_members WHERE collection_id = ? AND status = 'active' AND role = 'managing'", collectionId))!.n;

async function setMember(collectionId: string, userId: string, fields: { status?: string; role?: Role; invited_by?: string }, ts: string) {
  const existing = await get("SELECT 1 FROM collection_members WHERE collection_id = ? AND user_id = ?", collectionId, userId);
  if (existing)
    await run(
      `UPDATE collection_members SET status = COALESCE(?::text, status), role = COALESCE(?::text, role), invited_by = COALESCE(?::text, invited_by), updated_at = ?
       WHERE collection_id = ? AND user_id = ?`,
      fields.status ?? null, fields.role ?? null, fields.invited_by ?? null, ts, collectionId, userId,
    );
  else
    await run(
      "INSERT INTO collection_members (collection_id, user_id, role, status, invited_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      collectionId, userId, fields.role ?? "editor", fields.status ?? "invited", fields.invited_by ?? null, ts, ts,
    );
}

/** Joining a board takes two people: a managing editor invites, the member accepts. */
export async function inviteMember(actorId: string, collectionId: string, handle: string, role: Role) {
  await tx(async () => {
    await byId(collectionId);
    await requireRole(collectionId, actorId, ["managing"]);
    if (!(role in ROLES)) fail("Unknown role.");
    const u = (await get<{ id: string }>("SELECT id FROM users WHERE lower(handle) = lower(?::text)", handle.trim().replace(/^@/, ""))) ?? fail(`No member @${handle.replace(/^@/, "")}.`);
    const m = await get<{ status: string }>("SELECT status FROM collection_members WHERE collection_id = ? AND user_id = ?", collectionId, u!.id);
    if (m?.status === "active") fail("They're already on the board.");
    if (m?.status === "invited") fail("They already have an invitation.");
    if ((await get<{ n: number }>("SELECT COUNT(*) AS n FROM collection_members WHERE collection_id = ? AND status IN ('active','invited')", collectionId))!.n >= LIMITS.board)
      fail(`A board can have at most ${LIMITS.board} members.`);
    const since = new Date(Date.now() - 86400_000).toISOString();
    if ((await get<{ n: number }>("SELECT COUNT(*) AS n FROM collection_log WHERE collection_id = ? AND kind = 'invited' AND created_at > ?", collectionId, since))!.n >= LIMITS.invitesPerDay)
      fail(`At most ${LIMITS.invitesPerDay} invitations a day per collection.`);
    const ts = now();
    await setMember(collectionId, u!.id, { status: "invited", role, invited_by: actorId }, ts);
    await appendCollectionEntry({ collectionId, kind: "invited", actorId, subject: u!.id, payload: { role }, createdAt: ts });
  });
}

export async function respondToInvitation(userId: string, collectionId: string, accept: boolean) {
  await tx(async () => {
    await byId(collectionId);
    const m = await get<{ status: string }>("SELECT status FROM collection_members WHERE collection_id = ? AND user_id = ?", collectionId, userId);
    if (m?.status !== "invited") fail("There's no open invitation for you on this board.");
    const ts = now();
    await setMember(collectionId, userId, { status: accept ? "active" : "declined" }, ts);
    await appendCollectionEntry({ collectionId, kind: accept ? "joined" : "declined_invite", actorId: userId, subject: userId, payload: {}, createdAt: ts });
  });
}

export async function leaveBoard(userId: string, collectionId: string) {
  await tx(async () => {
    const role = await requireRole(collectionId, userId);
    if (role === "managing" && (await activeManagers(collectionId)) === 1)
      fail("You're the only managing editor. Make someone else a managing editor before you leave, so the collection isn't orphaned.");
    const ts = now();
    await setMember(collectionId, userId, { status: "left" }, ts);
    await appendCollectionEntry({ collectionId, kind: "left", actorId: userId, subject: userId, payload: {}, createdAt: ts });
  });
}

/** Removing someone (or withdrawing their invitation) is logged with a public reason. */
export async function removeMember(actorId: string, collectionId: string, userId: string, reason: string) {
  await tx(async () => {
    await requireRole(collectionId, actorId, ["managing"]);
    if (userId === actorId) fail("To step down yourself, leave the board.");
    const m = await get<{ status: string }>("SELECT status FROM collection_members WHERE collection_id = ? AND user_id = ?", collectionId, userId);
    if (m?.status !== "active" && m?.status !== "invited") fail("They're not on the board.");
    if (reason.trim().length < 10) fail("Give a public reason (at least 10 characters). It goes into the collection's log.");
    const ts = now();
    await setMember(collectionId, userId, { status: "removed" }, ts);
    await appendCollectionEntry({ collectionId, kind: "removed", actorId, subject: userId, payload: { reason: reason.trim().slice(0, 2000), was: m!.status }, createdAt: ts });
  });
}

export async function setRole(actorId: string, collectionId: string, userId: string, role: Role) {
  await tx(async () => {
    await requireRole(collectionId, actorId, ["managing"]);
    if (!(role in ROLES)) fail("Unknown role.");
    const m = await get<{ status: string; role: Role }>("SELECT status, role FROM collection_members WHERE collection_id = ? AND user_id = ?", collectionId, userId);
    if (m?.status !== "active") fail("They're not an active board member.");
    if (m!.role === role) fail(`They're already ${ROLES[role].label.toLowerCase()}.`);
    if (m!.role === "managing" && (await activeManagers(collectionId)) === 1) fail("A collection needs at least one managing editor.");
    const ts = now();
    await setMember(collectionId, userId, { role }, ts);
    await appendCollectionEntry({ collectionId, kind: "role", actorId, subject: userId, payload: { role }, createdAt: ts });
  });
}

// ───────────────────────────── Works ─────────────────────────────

async function latestOf(contributionId: string) {
  return (
    (await get<{ status: string; latest_version: number; content_hash: string }>(
      `SELECT c.status, c.latest_version, v.content_hash FROM contributions c
       JOIN versions v ON v.contribution_id = c.id AND v.number = c.latest_version WHERE c.id = ?`,
      contributionId,
    )) ?? fail(`No work with id "${contributionId}".`)
  );
}

const itemOf = (collectionId: string, contributionId: string) =>
  get<{ status: ItemStatus; version_number: number; nominated: number }>(
    "SELECT status, version_number, nominated FROM collection_items WHERE collection_id = ? AND contribution_id = ?",
    collectionId, contributionId,
  );

async function setItem(collectionId: string, contributionId: string, seq: number, ts: string, f: {
  status: ItemStatus; version?: number; submittedBy?: string; nominated?: boolean; note?: string;
  decidedBy?: string | null; decisionNote?: string | null; decided?: boolean;
}) {
  if (f.submittedBy) {
    // A (re)submission starts a fresh round: earlier decisions stay in the log, not on the item.
    await run(
      `INSERT INTO collection_items (collection_id, contribution_id, status, version_number, submitted_by, nominated, note, log_seq, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (collection_id, contribution_id) DO UPDATE SET status = excluded.status, version_number = excluded.version_number,
         submitted_by = excluded.submitted_by, nominated = excluded.nominated, note = excluded.note, decided_by = NULL,
         decision_note = NULL, decided_at = NULL, log_seq = excluded.log_seq, created_at = excluded.created_at, updated_at = excluded.updated_at`,
      collectionId, contributionId, f.status, f.version!, f.submittedBy, f.nominated ? 1 : 0, f.note ?? "", seq, ts, ts,
    );
    return;
  }
  await run(
    `UPDATE collection_items SET status = ?, version_number = COALESCE(?::integer, version_number), log_seq = ?, updated_at = ?,
       decided_by = CASE WHEN ?::boolean THEN ?::text ELSE decided_by END, decision_note = CASE WHEN ?::boolean THEN ?::text ELSE decision_note END,
       decided_at = CASE WHEN ?::boolean THEN ?::text ELSE decided_at END
     WHERE collection_id = ? AND contribution_id = ?`,
    f.status, f.version ?? null, seq, ts, !!f.decided, f.decidedBy ?? null, !!f.decided, f.decisionNote ?? null,
    !!f.decided, ts, collectionId, contributionId,
  );
}

async function checkResubmission(collectionId: string, contributionId: string, latest: number) {
  const prev = await itemOf(collectionId, contributionId);
  if (prev?.status === "submitted") fail("It's already under consideration here.");
  if (prev?.status === "selected") fail("It's already selected for this collection.");
  if (prev?.status === "declined" && latest <= prev.version_number)
    fail(`Version ${prev.version_number} was not selected. Post a new version that addresses the decision, then submit again.`);
}

/** Authors submit their own work. Native works: the submitter; imported works: authors verified through ORCID. */
export async function submitWork(userId: string, collectionId: string, contributionId: string, note: string) {
  await tx(async () => {
    const c = await byId(collectionId);
    if (!c.accepts_submissions) fail("This board doesn't take submissions; its editors nominate works themselves.");
    const w = await latestOf(contributionId);
    if (w.status !== "active") fail("Retracted or removed work can't be submitted.");
    if (!(await isAuthorOf(userId, contributionId)))
      fail("Only a work's authors can submit it. (Wrote an imported paper? Claim it with ORCID first.) Editors can nominate any work.");
    await checkResubmission(collectionId, contributionId, w.latest_version);
    const since = new Date(Date.now() - 86400_000).toISOString();
    if ((await get<{ n: number }>("SELECT COUNT(*) AS n FROM collection_log WHERE actor_id = ? AND kind = 'submitted' AND created_at > ?", userId, since))!.n >= LIMITS.submissionsPerDay)
      fail(`At most ${LIMITS.submissionsPerDay} submissions a day.`);
    const ts = now();
    const payload = { version: w.latest_version, version_content_hash: w.content_hash, nominated: false, note: note.trim().slice(0, 2000) };
    const seq = await appendCollectionEntry({ collectionId, kind: "submitted", actorId: userId, subject: contributionId, payload, createdAt: ts });
    await setItem(collectionId, contributionId, seq, ts, { status: "submitted", version: w.latest_version, submittedBy: userId, nominated: false, note: payload.note });
  });
}

/** Editors can propose any open work for their collection — the overlay-journal model. */
export async function nominateWork(actorId: string, collectionId: string, contributionId: string, note: string) {
  await tx(async () => {
    await byId(collectionId);
    await requireRole(collectionId, actorId);
    const w = await latestOf(contributionId);
    if (w.status !== "active") fail("Retracted or removed work can't be nominated.");
    if (await isAuthorOf(actorId, contributionId)) fail("That's your own work: submit it as an author from its page. Another editor will decide.");
    await checkResubmission(collectionId, contributionId, w.latest_version);
    const ts = now();
    const payload = { version: w.latest_version, version_content_hash: w.content_hash, nominated: true, note: note.trim().slice(0, 2000) };
    const seq = await appendCollectionEntry({ collectionId, kind: "submitted", actorId, subject: contributionId, payload, createdAt: ts });
    await setItem(collectionId, contributionId, seq, ts, { status: "submitted", version: w.latest_version, submittedBy: actorId, nominated: true, note: payload.note });
  });
}

/**
 * Authors keep control: they can withdraw from a collection at any time, even after selection.
 * Editors can drop a nomination nobody has decided on yet.
 */
export async function withdrawWork(userId: string, collectionId: string, contributionId: string, note: string) {
  await tx(async () => {
    await byId(collectionId);
    const item = await itemOf(collectionId, contributionId);
    if (item?.status !== "submitted" && item?.status !== "selected") fail("It isn't under consideration or selected here.");
    const author = await isAuthorOf(userId, contributionId);
    const board = !!(await roleOf(collectionId, userId)) && item!.nominated === 1 && item!.status === "submitted";
    if (!author && !board) fail("Only the authors can withdraw a work. Editors can drop nominations that haven't been decided.");
    const ts = now();
    const seq = await appendCollectionEntry({
      collectionId, kind: "withdrawn", actorId: userId, subject: contributionId,
      payload: { by: author ? "author" : "board", was: item!.status, note: note.trim().slice(0, 2000) }, createdAt: ts,
    });
    await setItem(collectionId, contributionId, seq, ts, { status: "withdrawn" });
  });
}

/**
 * An editorial decision: signed, reasoned, declared, and pinned to the exact version and policy it was
 * made on. Editors can't decide on their own work, and selection needs the public reviews the policy promises.
 */
export async function decide(actorId: string, collectionId: string, contributionId: string, d: { select: boolean; note: string; competingInterests: string }) {
  await tx(async () => {
    const c = await byId(collectionId);
    await requireRole(collectionId, actorId);
    const item = await itemOf(collectionId, contributionId);
    if (item?.status !== "submitted") fail("This work isn't awaiting a decision.");
    if (await isAuthorOf(actorId, contributionId)) fail("You're an author of this work, so another editor has to decide.");
    if (!d.select && item!.nominated)
      fail("Nominations aren't declined in public: the authors never asked to be considered. Drop the nomination instead.");
    const note = d.note.trim();
    if (note.length < 30) fail("Explain the decision against the collection's criteria (at least 30 characters). It's public.");
    const w = await latestOf(contributionId);
    if (d.select && w.status !== "active") fail("Retracted work can't be selected.");
    const reviews = (await all<{ id: string }>("SELECT id FROM reviews WHERE contribution_id = ? AND hidden = 0 ORDER BY created_at ASC", contributionId)).map((r) => r.id);
    if (d.select && reviews.length < c.min_reviews)
      fail(
        `This collection selects only work with at least ${c.min_reviews} public review${c.min_reviews === 1 ? "" : "s"}; this one has ${reviews.length}. ` +
          "Invite reviewers: anyone can review, and editors can too (your review then counts like any other).",
      );
    const ts = now();
    const payload = {
      version: w.latest_version,
      version_content_hash: w.content_hash,
      note: note.slice(0, 10_000),
      competing_interests: d.competingInterests.trim().slice(0, 2000),
      reviews,
      policy_hash: policyHash(c),
    };
    const seq = await appendCollectionEntry({ collectionId, kind: d.select ? "selected" : "declined", actorId, subject: contributionId, payload, createdAt: ts });
    await setItem(collectionId, contributionId, seq, ts, {
      status: d.select ? "selected" : "declined", version: w.latest_version, decided: true, decidedBy: actorId, decisionNote: payload.note,
    });
  });
}

/** Undoing a selection (e.g. after a retraction) is itself a public, reasoned decision. */
export async function deselect(actorId: string, collectionId: string, contributionId: string, note: string) {
  await tx(async () => {
    await byId(collectionId);
    await requireRole(collectionId, actorId);
    const item = await itemOf(collectionId, contributionId);
    if (item?.status !== "selected") fail("It isn't selected here.");
    if (await isAuthorOf(actorId, contributionId)) fail("You're an author of this work, so another editor has to decide.");
    if (note.trim().length < 30) fail("Explain publicly why the selection is withdrawn (at least 30 characters).");
    const ts = now();
    const seq = await appendCollectionEntry({ collectionId, kind: "deselected", actorId, subject: contributionId, payload: { note: note.trim().slice(0, 10_000) }, createdAt: ts });
    await setItem(collectionId, contributionId, seq, ts, { status: "removed", decided: true, decidedBy: actorId, decisionNote: note.trim().slice(0, 10_000) });
  });
}
