import "server-only";
import { all, get, run } from "./db";
import type { ArtifactKind, Declarations, License, SourceRecord } from "./constants";
import {
  GENESIS,
  REVIEW_CONTENT_SQL,
  canonicalJson,
  collectionChainHash,
  collectionEntryHash,
  reviewChainHash,
  reviewContentHash,
  reviewContentOf,
  sha256,
  type ReviewContent,
} from "./hash";

export { GENESIS, canonicalJson };

export type Artifact = { kind: ArtifactKind; label: string; url: string; pin: string };

export type VersionContent = {
  title: string;
  abstract: string;
  body: string;
  authors: string[];
  license: License;
  artifacts: Artifact[];
  /** Absent on versions published before declarations existed; those hash exactly as they always did. */
  declarations?: Declarations;
  /** Only on imported works: the metadata snapshot of where the work was actually published. */
  source?: SourceRecord;
};

export function contentHash(c: VersionContent): string {
  return sha256(
    canonicalJson({
      title: c.title,
      abstract: c.abstract,
      body: c.body,
      authors: c.authors,
      license: c.license,
      artifacts: c.artifacts,
      declarations: c.declarations,
      source: c.source,
    }),
  );
}

export function chainHash(prev: string, content: string, contributionId: string, number: number, createdAt: string) {
  return sha256(`${prev}|${content}|${contributionId}|${number}|${createdAt}`);
}

/** Must be called inside tx(): reads the ledger head and appends atomically. */
export function appendVersion(args: {
  contributionId: string;
  number: number;
  content: VersionContent;
  changeNote: string;
  createdBy: string;
  createdAt: string;
}) {
  const head = get<{ chain_hash: string }>("SELECT chain_hash FROM versions ORDER BY seq DESC LIMIT 1");
  const prev = head?.chain_hash ?? GENESIS;
  const ch = contentHash(args.content);
  const chain = chainHash(prev, ch, args.contributionId, args.number, args.createdAt);
  const c = args.content;
  const res = run(
    `INSERT INTO versions (contribution_id, number, title, abstract, body, authors, license, artifacts, declarations, source,
       change_note, content_hash, prev_chain_hash, chain_hash, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args.contributionId, args.number, c.title, c.abstract, c.body, JSON.stringify(c.authors), c.license,
    JSON.stringify(c.artifacts), c.declarations ? JSON.stringify(c.declarations) : null, c.source ? JSON.stringify(c.source) : null,
    args.changeNote, ch, prev, chain, args.createdBy, args.createdAt,
  );
  return { seq: Number(res.lastInsertRowid), contentHash: ch, chainHash: chain, prevChainHash: prev };
}

export type LedgerRow = {
  seq: number;
  contribution_id: string;
  number: number;
  title: string;
  abstract: string;
  body: string;
  authors: string;
  license: License;
  artifacts: string;
  declarations: string | null;
  source: string | null;
  content_hash: string;
  prev_chain_hash: string;
  chain_hash: string;
  created_at: string;
};

export function rowContent(r: LedgerRow): VersionContent {
  return {
    title: r.title,
    abstract: r.abstract,
    body: r.body,
    authors: JSON.parse(r.authors),
    license: r.license,
    artifacts: JSON.parse(r.artifacts),
    declarations: r.declarations ? JSON.parse(r.declarations) : undefined,
    source: r.source ? JSON.parse(r.source) : undefined,
  };
}

// ───────────────────────────── Review chain ─────────────────────────────
// Reviews are publications too: each one is hashed and appended to its own chain, so a reviewer
// can prove what they wrote and when, and nobody can edit a review after the fact.

/** Must be called inside tx(), after the review row is inserted. */
export function appendReviewEntry(reviewId: string, createdAt: string) {
  const r = get<ReviewContent & { id: string }>(`${REVIEW_CONTENT_SQL} WHERE r.id = ?`, reviewId);
  if (!r) throw new Error(`Review ${reviewId} not found for the ledger.`);
  const head = get<{ chain_hash: string }>("SELECT chain_hash FROM review_ledger ORDER BY seq DESC LIMIT 1");
  const prev = head?.chain_hash ?? GENESIS;
  const content = reviewContentHash(reviewContentOf(r));
  const chain = reviewChainHash(prev, content, reviewId, createdAt);
  const res = run(
    "INSERT INTO review_ledger (review_id, content_hash, prev_chain_hash, chain_hash, created_at) VALUES (?,?,?,?,?)",
    reviewId, content, prev, chain, createdAt,
  );
  return { seq: Number(res.lastInsertRowid), contentHash: content, chainHash: chain };
}

type Verification = { ok: boolean; checked: number; firstBadSeq?: number; reason?: string };

function verifyReviewChain(): Verification {
  const rows = all<ReviewContent & { id: string; seq: number; content_hash: string; prev_chain_hash: string; chain_hash: string; entry_at: string }>(
    `${REVIEW_CONTENT_SQL.replace("SELECT r.id,", "SELECT l.seq, l.content_hash, l.prev_chain_hash, l.chain_hash, l.created_at AS entry_at, r.id,")}
     JOIN review_ledger l ON l.review_id = r.id ORDER BY l.seq ASC`,
  );
  let prev = GENESIS;
  for (const r of rows) {
    const bad = (reason: string) => ({ ok: false, checked: rows.length, firstBadSeq: r.seq, reason: `review chain: ${reason}` });
    if (r.prev_chain_hash !== prev) return bad("broken link");
    if (reviewContentHash(reviewContentOf(r)) !== r.content_hash) return bad("review content altered");
    if (reviewChainHash(prev, r.content_hash, r.id, r.entry_at) !== r.chain_hash) return bad("chain hash mismatch");
    prev = r.chain_hash;
  }
  const total = get<{ n: number }>("SELECT COUNT(*) AS n FROM reviews")!.n;
  if (total !== rows.length) return { ok: false, checked: rows.length, reason: `review chain: ${total - rows.length} reviews missing from the ledger` };
  return { ok: true, checked: rows.length };
}

// ───────────────────────────── Collection chain ─────────────────────────────
// Every board change and editorial decision of every collection, in one chain. A board can't
// quietly rewrite who decided what, when, on which exact version, under which stated policy.

/** The public settings of a collection. Snapshotted into the log whenever they change. */
export const POLICY_FIELDS = ["name", "tagline", "scope", "policy", "min_reviews", "accepts_submissions", "accent", "continues"] as const;
export type CollectionPolicy = {
  name: string;
  tagline: string;
  scope: string;
  policy: string;
  min_reviews: number;
  accepts_submissions: number;
  accent: string;
  continues: unknown; // Lineage or null
};

/** From a `collections` row (continues stored as JSON text) to the snapshot that is logged. */
export function collectionPolicy(r: Omit<CollectionPolicy, "continues"> & { continues: string | null }): CollectionPolicy {
  return {
    name: r.name,
    tagline: r.tagline,
    scope: r.scope,
    policy: r.policy,
    min_reviews: r.min_reviews,
    accepts_submissions: r.accepts_submissions,
    accent: r.accent,
    continues: r.continues ? JSON.parse(r.continues) : null,
  };
}

/** Must be called inside tx(). Returns the new entry's sequence number. */
export function appendCollectionEntry(args: {
  collectionId: string;
  kind: string;
  actorId: string;
  subject: string | null;
  payload: unknown;
  createdAt: string;
}) {
  const head = get<{ chain_hash: string }>("SELECT chain_hash FROM collection_log ORDER BY seq DESC LIMIT 1");
  const prev = head?.chain_hash ?? GENESIS;
  const payload = JSON.parse(JSON.stringify(args.payload ?? {})); // exactly what will be read back
  const content = collectionEntryHash({
    collection_id: args.collectionId, kind: args.kind, actor_id: args.actorId, subject: args.subject, payload, created_at: args.createdAt,
  });
  const chain = collectionChainHash(prev, content, args.createdAt);
  const res = run(
    `INSERT INTO collection_log (collection_id, kind, actor_id, subject, payload, content_hash, prev_chain_hash, chain_hash, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    args.collectionId, args.kind, args.actorId, args.subject, JSON.stringify(payload), content, prev, chain, args.createdAt,
  );
  return Number(res.lastInsertRowid);
}

/** What the log says each item's status is after an entry of this kind. */
const ITEM_STATUS: Record<string, string> = {
  submitted: "submitted", selected: "selected", declined: "declined", withdrawn: "withdrawn", deselected: "removed",
};
const MEMBER_STATUS: Record<string, string> = {
  founded: "active", invited: "invited", joined: "active", declined_invite: "declined", left: "left", removed: "removed",
};

function verifyCollectionChain(): Verification {
  const rows = all<{
    seq: number; collection_id: string; kind: string; actor_id: string; subject: string | null; payload: string;
    content_hash: string; prev_chain_hash: string; chain_hash: string; created_at: string;
  }>("SELECT * FROM collection_log ORDER BY seq ASC");
  const items = new Map<string, { status: string; version: number; seq: number }>();
  const members = new Map<string, { status: string; role: string }>();
  const policies = new Map<string, string>();
  let prev = GENESIS;
  for (const r of rows) {
    const bad = (reason: string) => ({ ok: false, checked: rows.length, firstBadSeq: r.seq, reason: `collection chain: ${reason}` });
    if (r.prev_chain_hash !== prev) return bad("broken link");
    const payload = JSON.parse(r.payload) as Record<string, unknown>;
    const entry = { collection_id: r.collection_id, kind: r.kind, actor_id: r.actor_id, subject: r.subject, payload, created_at: r.created_at };
    if (collectionEntryHash(entry) !== r.content_hash) return bad("entry altered");
    if (collectionChainHash(prev, r.content_hash, r.created_at) !== r.chain_hash) return bad("chain hash mismatch");
    prev = r.chain_hash;

    // Replay, so the current state can be checked against the log below.
    const key = `${r.collection_id}|${r.subject}`;
    if (r.kind === "founded" || r.kind === "policy")
      policies.set(r.collection_id, canonicalJson(Object.fromEntries(POLICY_FIELDS.map((f) => [f, payload[f]]))));
    if (r.kind in ITEM_STATUS) {
      const version = typeof payload.version === "number" ? payload.version : items.get(key)?.version ?? 0;
      items.set(key, { status: ITEM_STATUS[r.kind], version, seq: r.seq });
    }
    if (r.kind in MEMBER_STATUS || r.kind === "role") {
      const role = typeof payload.role === "string" ? payload.role : members.get(key)?.role ?? "editor";
      members.set(key, { status: MEMBER_STATUS[r.kind] ?? members.get(key)?.status ?? "active", role });
    }
  }
  const fail = (reason: string) => ({ ok: false, checked: rows.length, reason: `collection state: ${reason}` });

  const itemRows = all<{ collection_id: string; contribution_id: string; status: string; version_number: number; log_seq: number }>(
    "SELECT collection_id, contribution_id, status, version_number, log_seq FROM collection_items",
  );
  if (itemRows.length !== items.size) return fail("items and log disagree on how many works were ever submitted");
  for (const i of itemRows) {
    const e = items.get(`${i.collection_id}|${i.contribution_id}`);
    if (!e || e.status !== i.status || e.version !== i.version_number || e.seq !== i.log_seq)
      return fail(`fj:${i.contribution_id} is "${i.status}" in ${i.collection_id}, but the log says otherwise`);
  }
  const memberRows = all<{ collection_id: string; user_id: string; status: string; role: string }>(
    "SELECT collection_id, user_id, status, role FROM collection_members",
  );
  if (memberRows.length !== members.size) return fail("board records and log disagree");
  for (const m of memberRows) {
    const e = members.get(`${m.collection_id}|${m.user_id}`);
    if (!e || e.status !== m.status || e.role !== m.role) return fail(`a board membership of ${m.collection_id} differs from the log`);
  }
  const collections = all<CollectionPolicy & { id: string; continues: string | null }>(`SELECT id, ${POLICY_FIELDS.join(", ")} FROM collections`);
  if (collections.length !== policies.size) return fail("a collection exists without a founding entry");
  for (const c of collections)
    if (policies.get(c.id) !== canonicalJson(collectionPolicy(c))) return fail(`the policy of ${c.id} was changed outside the log`);
  return { ok: true, checked: rows.length };
}

/** Recompute every hash from stored content, in all three chains. Any tampering breaks a chain from that point on. */
export function verifyLedger(): Verification & { versions: Verification; reviews: Verification; collections: Verification } {
  const versions = verifyVersionChain();
  const reviews = verifyReviewChain();
  const collections = verifyCollectionChain();
  const first = [versions, reviews, collections].find((v) => !v.ok) ?? versions;
  return {
    ...first,
    ok: versions.ok && reviews.ok && collections.ok,
    checked: versions.checked + reviews.checked + collections.checked,
    versions,
    reviews,
    collections,
  };
}

function verifyVersionChain(): Verification {
  const rows = all<LedgerRow>("SELECT * FROM versions ORDER BY seq ASC");
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_chain_hash !== prev) return { ok: false, checked: rows.length, firstBadSeq: r.seq, reason: "broken link" };
    if (contentHash(rowContent(r)) !== r.content_hash)
      return { ok: false, checked: rows.length, firstBadSeq: r.seq, reason: "content altered" };
    if (chainHash(prev, r.content_hash, r.contribution_id, r.number, r.created_at) !== r.chain_hash)
      return { ok: false, checked: rows.length, firstBadSeq: r.seq, reason: "chain hash mismatch" };
    prev = r.chain_hash;
  }
  return { ok: true, checked: rows.length };
}
